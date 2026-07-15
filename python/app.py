"""Bridges locais reais para os motores de áudio do Voice Lab.

Cada processo iniciado pelo Companion recebe ``VOICE_LAB_ACTIVE_ENGINE`` e atende
somente aquele motor. Imports de PyTorch e carregamento de checkpoints são
preguiçosos: iniciar o bridge não reserva GPU nem carrega modelos pesados.
"""

from __future__ import annotations

import importlib.util
import io
import os
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

app = FastAPI(title="Voice Lab Audio Bridge", version="1.1.0")

ACTIVE_ENGINE = os.getenv("VOICE_LAB_ACTIVE_ENGINE", "all").strip().lower()
MAX_UPLOAD_BYTES = int(os.getenv("VOICE_LAB_MAX_UPLOAD_BYTES", str(50 * 1024 * 1024)))
INTERNAL_TOKEN = os.getenv("VOICE_LAB_INTERNAL_TOKEN", "")
INTERNAL_TOKEN_HEADER = "x-voice-lab-internal-token"
MODEL_LOAD_LOCK = threading.Lock()
MODEL_LOAD_STATE: dict[str, Any] = {"state": "idle", "startedAt": None, "completedAt": None, "error": None}


@app.middleware("http")
async def require_internal_token(request: Request, call_next):
    if request.url.path == "/health":
        return await call_next(request)
    if not INTERNAL_TOKEN:
        return JSONResponse(
            status_code=503,
            content={
                "ok": False,
                "error": {
                    "code": "INTERNAL_AUTH_NOT_CONFIGURED",
                    "message": "Este bridge deve ser iniciado pelo Voice Lab Companion.",
                },
            },
        )
    candidate = request.headers.get(INTERNAL_TOKEN_HEADER, "")
    if not candidate or not secrets.compare_digest(candidate, INTERNAL_TOKEN):
        return JSONResponse(
            status_code=401,
            content={
                "ok": False,
                "error": {
                    "code": "INTERNAL_AUTH_REQUIRED",
                    "message": "Pareamento interno do Companion ausente ou inválido.",
                },
            },
        )
    return await call_next(request)


def voice_lab_home() -> Path:
    configured = os.getenv("VOICE_LAB_HOME")
    if configured:
        return Path(configured).expanduser().resolve()
    if os.name == "nt":
        return Path(os.getenv("LOCALAPPDATA", Path.home() / "AppData" / "Local")) / "VoiceLab"
    return Path(os.getenv("XDG_DATA_HOME", Path.home() / ".local" / "share")) / "voice-lab"


def dependency_present(name: str) -> bool:
    root_modules = {
        "kokoro": ("kokoro",),
        "whisper": ("faster_whisper",),
        "xtts": ("TTS",),
        "openvoice": ("openvoice.api", "melo.api", "pkg_resources"),
        "rvc": ("rvc",),
        "transformers": ("transformers", "torch", "mistral_common", "soundfile"),
    }.get(name, ())
    try:
        return bool(root_modules) and all(importlib.util.find_spec(module) is not None for module in root_modules)
    except (ImportError, ModuleNotFoundError, ValueError):
        return False


@lru_cache(maxsize=8)
def dependency_probe(name: str) -> tuple[bool, Optional[str]]:
    """Importa o adapter, sem carregar checkpoint, para validar a instalação real."""

    required_modules = {
        "kokoro": ("kokoro", "soundfile"),
        "whisper": ("faster_whisper",),
        "xtts": ("TTS.api", "torch", "soundfile"),
        "openvoice": ("openvoice.api", "melo.api", "torch", "soundfile"),
        "rvc": ("rvc",),
        "transformers": ("transformers", "torch", "mistral_common", "soundfile"),
    }.get(name, ())
    if not required_modules:
        return False, "motor desconhecido"
    try:
        for module in required_modules:
            __import__(module)
        if name == "transformers":
            # Verifica a classe concreta exigida, não apenas um pacote Transformers qualquer.
            from transformers import VoxtralForConditionalGeneration  # noqa: F401

        return True, None
    except Exception as error:  # bibliotecas nativas também podem falhar durante import
        return False, f"{type(error).__name__}: {error}"


def dependency_available(name: str) -> bool:
    return dependency_probe(name)[0]


def engine_selected(name: str) -> bool:
    aliases = {"voxtral": "transformers"}
    return ACTIVE_ENGINE in {"all", name, aliases.get(name, name)}


def require_engine(name: str) -> None:
    if not engine_selected(name):
        raise HTTPException(
            status_code=409,
            detail={
                "code": "PYTHON_ENGINE_NOT_ACTIVE",
                "message": f"Este processo foi iniciado para '{ACTIVE_ENGINE}', não para '{name}'.",
                "hint": "Inicie o Voice Lab Companion; ele cria um bridge isolado para cada motor instalado.",
            },
        )


def not_ready(engine: str, install_hint: str) -> None:
    raise HTTPException(
        status_code=503,
        detail={
            "code": "PYTHON_ENGINE_NOT_INSTALLED",
            "message": f"As dependências locais de {engine} não foram reconhecidas neste ambiente Python.",
            "hint": install_hint,
        },
    )


def model_missing(engine: str, message: str, hint: str) -> None:
    raise HTTPException(
        status_code=424,
        detail={"code": "LOCAL_MODEL_MISSING", "message": f"{engine}: {message}", "hint": hint},
    )


def unsupported(message: str, hint: str = "") -> None:
    raise HTTPException(
        status_code=501,
        detail={"code": "CAPABILITY_UNSUPPORTED", "message": message, "hint": hint},
    )


@app.exception_handler(HTTPException)
async def http_error(_request, exc: HTTPException):
    detail = exc.detail if isinstance(exc.detail, dict) else {"code": "PYTHON_ERROR", "message": str(exc.detail)}
    return JSONResponse(status_code=exc.status_code, content={"ok": False, "error": detail})


def _openvoice_paths() -> dict[str, Any]:
    root = Path(os.getenv("OPENVOICE_MODEL_PATH", voice_lab_home() / "models" / "openvoice"))
    if (root / "checkpoints_v2").is_dir():
        root = root / "checkpoints_v2"
    converter = root / "converter"
    return {
        "root": root,
        "converter_config": converter / "config.json",
        "converter_checkpoint": converter / "checkpoint.pth",
        "speaker_embeddings": root / "base_speakers" / "ses",
    }


def _rvc_models() -> list[Path]:
    configured = os.getenv("RVC_MODEL_PATH")
    if configured and Path(configured).expanduser().is_file():
        return [Path(configured).expanduser().resolve()]
    root = Path(configured).expanduser() if configured else voice_lab_home() / "models" / "rvc"
    return sorted(root.glob("*.pth")) if root.is_dir() else []


def _hf_model_cached(repo_id: str) -> bool:
    explicit_cache = os.getenv("HF_HUB_CACHE")
    hf_home = Path(os.getenv("HF_HOME") or Path.home() / ".cache" / "huggingface")
    cache_root = Path(explicit_cache) if explicit_cache else hf_home / "hub"
    model_root = cache_root / ("models--" + repo_id.replace("/", "--"))
    snapshots = model_root / "snapshots"
    return snapshots.is_dir() and any(item.is_dir() for item in snapshots.iterdir())


def _model_status(name: str) -> dict[str, Any]:
    if name == "openvoice":
        paths = _openvoice_paths()
        present = all(paths[key].is_file() for key in ("converter_config", "converter_checkpoint")) and paths[
            "speaker_embeddings"
        ].is_dir()
        return {"configured": present, "loaded": bool(openvoice_converter.cache_info().currsize), "path": str(paths["root"])}
    if name == "rvc":
        models = _rvc_models()
        return {"configured": bool(models), "loaded": False, "models": [model.name for model in models]}
    if name == "transformers":
        model_id = os.getenv("VOXTRAL_MODEL_PATH") or "mistralai/Voxtral-Mini-3B-2507"
        local = Path(model_id).expanduser().exists() if Path(model_id).is_absolute() else _hf_model_cached(model_id)
        return {"configured": local, "loaded": bool(voxtral_components.cache_info().currsize), "model": model_id}
    if name == "xtts":
        model_id = os.getenv("XTTS_MODEL_PATH") or "tts_models/multilingual/multi-dataset/xtts_v2"
        if os.getenv("XTTS_MODEL_PATH"):
            local = Path(model_id).expanduser().exists()
        else:
            encoded = model_id.replace("/", "--")
            roots = [Path.home() / ".local" / "share" / "tts"]
            if os.getenv("TTS_HOME"):
                roots.append(Path(os.environ["TTS_HOME"]))
            if os.getenv("LOCALAPPDATA"):
                roots.append(Path(os.environ["LOCALAPPDATA"]) / "tts")
            local = any((root / encoded).exists() for root in roots)
        return {"configured": local, "loaded": bool(xtts_model.cache_info().currsize), "model": model_id}
    if name == "whisper":
        model_id = os.getenv("WHISPER_MODEL_PATH", "tiny")
        local = Path(model_id).expanduser().exists() or _hf_model_cached(f"Systran/faster-whisper-{model_id}")
        return {"configured": local, "loaded": bool(whisper_model.cache_info().currsize), "model": model_id}
    if name == "kokoro":
        return {"configured": _hf_model_cached("hexgrad/Kokoro-82M"), "loaded": bool(kokoro_pipeline.cache_info().currsize), "model": "hexgrad/Kokoro-82M"}
    return {"configured": False, "loaded": False}


@app.get("/health")
def health(deep: bool = False):
    engines: dict[str, Any] = {}
    for name in ("kokoro", "whisper", "xtts", "openvoice", "rvc", "transformers"):
        selected = engine_selected(name)
        if deep and selected:
            installed, dependency_error = dependency_probe(name)
        else:
            installed, dependency_error = dependency_present(name), None
        engines[name] = {
            "installed": installed,
            "initialized": installed and selected,
            "selected": selected,
            "detection": "deep-python-import" if deep and selected else "module-presence",
            "dependencyError": dependency_error,
            "model": _model_status(name),
        }
    return {
        "ok": True,
        "activeEngine": ACTIVE_ENGINE,
        "pid": os.getpid(),
        "hostRole": "local-python-bridge",
        "modelsLoadedAtStartup": False,
        "deepVerification": deep,
        "engines": engines,
    }


class ModelControlRequest(BaseModel):
    engine: str
    options: dict[str, Any] = Field(default_factory=dict)


def model_control_payload(engine: str) -> dict[str, Any]:
    status = _model_status(engine)
    return {
        "engine": engine,
        "state": "loaded" if status.get("loaded") else MODEL_LOAD_STATE["state"],
        "configured": bool(status.get("configured")),
        "loaded": bool(status.get("loaded")),
        "model": status.get("model"),
        "models": status.get("models"),
        "path": status.get("path"),
        "startedAt": MODEL_LOAD_STATE["startedAt"],
        "completedAt": MODEL_LOAD_STATE["completedAt"],
        "error": MODEL_LOAD_STATE["error"],
        "progressAvailable": False,
    }


@app.post("/api/models/status")
def model_status(request: ModelControlRequest):
    engine = request.engine.strip().lower()
    require_engine(engine)
    return model_control_payload(engine)


@app.post("/api/models/load")
def load_model(request: ModelControlRequest):
    engine = request.engine.strip().lower()
    require_engine(engine)
    if engine not in {"kokoro", "whisper", "xtts", "openvoice", "transformers"}:
        raise HTTPException(400, {"code": "MODEL_ENGINE_INVALID", "message": f"O motor {engine} não oferece preload explícito."})
    if not dependency_available(engine):
        not_ready(engine, "Execute o comando único de instalação na tela Instalação e Diagnóstico.")
    current = _model_status(engine)
    if current.get("loaded"):
        return {**model_control_payload(engine), "alreadyLoaded": True, "elapsedMs": 0}
    if not MODEL_LOAD_LOCK.acquire(blocking=False):
        raise HTTPException(
            409,
            {
                "code": "MODEL_LOAD_IN_PROGRESS",
                "message": "Este bridge já está carregando um checkpoint.",
                "hint": "Aguarde a operação atual; uma segunda cópia não será iniciada.",
            },
        )

    started = time.perf_counter()
    MODEL_LOAD_STATE.update({"state": "loading", "startedAt": time.time(), "completedAt": None, "error": None})
    try:
        if engine == "kokoro":
            kokoro_pipeline(str(request.options.get("language") or "pt-br"))
        elif engine == "whisper":
            whisper_model()
        elif engine == "xtts":
            xtts_model()
        elif engine == "openvoice":
            openvoice_converter()
            language = str(request.options.get("language") or "en").lower()
            language_code = {"en": "EN", "es": "ES", "fr": "FR", "zh": "ZH", "ja": "JP", "ko": "KR"}.get(language, "EN")
            melo_tts(language_code)
        elif engine == "transformers":
            voxtral_components()
        MODEL_LOAD_STATE.update({"state": "loaded", "completedAt": time.time()})
        return {
            **model_control_payload(engine),
            "loaded": True,
            "state": "loaded",
            "alreadyLoaded": False,
            "elapsedMs": round((time.perf_counter() - started) * 1000),
        }
    except HTTPException:
        MODEL_LOAD_STATE.update({"state": "error", "completedAt": time.time(), "error": "O bridge recusou o carregamento."})
        raise
    except Exception as error:
        MODEL_LOAD_STATE.update({"state": "error", "completedAt": time.time(), "error": f"{type(error).__name__}: {error}"})
        raise HTTPException(
            500,
            {
                "code": "MODEL_LOAD_ERROR",
                "message": f"{type(error).__name__}: {error}",
                "hint": "Verifique download, licença do checkpoint, RAM/VRAM e o log do bridge local.",
            },
        ) from error
    finally:
        MODEL_LOAD_LOCK.release()


async def save_upload(audio: UploadFile, default_name: str) -> str:
    data = await audio.read(MAX_UPLOAD_BYTES + 1)
    if not data:
        raise HTTPException(400, {"code": "EMPTY_AUDIO", "message": "O arquivo de áudio está vazio."})
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, {"code": "AUDIO_TOO_LARGE", "message": "O áudio excede o limite local configurado."})
    suffix = Path(audio.filename or default_name).suffix.lower() or Path(default_name).suffix
    if suffix not in {".wav", ".mp3", ".m4a", ".webm", ".ogg", ".flac", ".aac"}:
        raise HTTPException(415, {"code": "AUDIO_FORMAT_UNSUPPORTED", "message": f"Formato de áudio não aceito: {suffix}"})
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temporary:
        temporary.write(data)
        return temporary.name


class TtsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    voice: str = "af_heart"
    language: str = "en-us"


@lru_cache(maxsize=4)
def kokoro_pipeline(language_code: str):
    try:
        from kokoro import KPipeline
    except ImportError:
        not_ready("Kokoro", "Execute o comando único de instalação na tela Instalação e Diagnóstico.")
    code = {"pt-br": "p", "pt": "p", "en-us": "a", "en": "a", "es": "e"}.get(language_code.lower(), "a")
    return KPipeline(lang_code=code)


@app.post("/api/tts/kokoro")
def tts_kokoro(request: TtsRequest):
    require_engine("kokoro")
    if not dependency_available("kokoro"):
        not_ready("Kokoro", "Execute o comando único de instalação na tela Instalação e Diagnóstico.")
    try:
        import numpy as np
        import soundfile as sf

        pipeline = kokoro_pipeline(request.language)
        segments = [audio for _graphemes, _phonemes, audio in pipeline(request.text, voice=request.voice)]
        if not segments:
            raise RuntimeError("Kokoro não produziu segmentos.")
        output = io.BytesIO()
        sf.write(output, np.concatenate(segments), 24_000, format="WAV")
        return Response(output.getvalue(), media_type="audio/wav")
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(500, {"code": "KOKORO_GENERATION_ERROR", "message": str(error)}) from error


@lru_cache(maxsize=1)
def whisper_model():
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        not_ready("Faster-Whisper", "Execute o comando único de instalação na tela Instalação e Diagnóstico.")
    return WhisperModel(
        os.getenv("WHISPER_MODEL_PATH", "tiny"),
        device=os.getenv("WHISPER_DEVICE", "cpu"),
        compute_type=os.getenv("WHISPER_COMPUTE_TYPE", "int8"),
    )


@app.post("/api/stt/whisper")
async def stt_whisper(audio: UploadFile = File(...), language: str = Form("pt")):
    require_engine("whisper")
    if not dependency_available("whisper"):
        not_ready("Faster-Whisper", "Execute o comando único de instalação na tela Instalação e Diagnóstico.")
    path = await save_upload(audio, "audio.wav")
    try:
        segments, info = whisper_model().transcribe(path, language=language or None)
        text = " ".join(segment.text.strip() for segment in segments)
        return {"ok": True, "text": text, "language": info.language, "duration": info.duration}
    except Exception as error:
        raise HTTPException(
            500,
            {
                "code": "WHISPER_TRANSCRIPTION_ERROR",
                "message": str(error),
                "hint": "O padrão seguro usa CPU/int8. Para GPU, configure explicitamente o CTranslate2 e as bibliotecas CUDA.",
            },
        ) from error
    finally:
        Path(path).unlink(missing_ok=True)


@lru_cache(maxsize=1)
def xtts_model():
    try:
        from TTS.api import TTS
    except ImportError:
        not_ready("XTTS-v2", "Instale o motor XTTS pela tela Instalação e Diagnóstico.")
    model_id = os.getenv("XTTS_MODEL_PATH") or "tts_models/multilingual/multi-dataset/xtts_v2"
    device = os.getenv("XTTS_DEVICE", "cpu").lower()
    if device.startswith("cuda"):
        import torch

        if not torch.cuda.is_available():
            raise HTTPException(
                503,
                {"code": "CUDA_UNAVAILABLE", "message": "XTTS_DEVICE solicita CUDA, mas PyTorch não detectou uma GPU CUDA."},
            )
    return TTS(model_name=model_id, progress_bar=False).to(device)


@app.post("/api/voice-clone/xtts")
async def clone_xtts(
    audio: UploadFile = File(...),
    text: str = Form(...),
    language: str = Form("pt"),
    consentConfirmed: bool = Form(...),
):
    require_engine("xtts")
    if not consentConfirmed:
        raise HTTPException(403, {"code": "VOICE_CONSENT_REQUIRED", "message": "Use apenas vozes próprias ou autorizadas."})
    if not dependency_available("xtts"):
        not_ready("XTTS-v2", "Instale o motor XTTS pela tela Instalação e Diagnóstico.")
    reference_path = await save_upload(audio, "reference.wav")
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as output:
        output_path = output.name
    try:
        xtts_model().tts_to_file(
            text=text[:5000], speaker_wav=reference_path, language=language, file_path=output_path
        )
        return Response(Path(output_path).read_bytes(), media_type="audio/wav")
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(500, {"code": "XTTS_GENERATION_ERROR", "message": str(error)}) from error
    finally:
        Path(reference_path).unlink(missing_ok=True)
        Path(output_path).unlink(missing_ok=True)


def require_openvoice_checkpoints() -> dict[str, Path]:
    paths = _openvoice_paths()
    missing = [str(paths[key]) for key in ("converter_config", "converter_checkpoint") if not paths[key].is_file()]
    if not paths["speaker_embeddings"].is_dir():
        missing.append(str(paths["speaker_embeddings"]))
    if missing:
        model_missing(
            "OpenVoice V2",
            "as dependências estão instaladas, mas os checkpoints oficiais não foram encontrados.",
            f"Extraia checkpoints_v2 em {paths['root']}. Ausentes: {', '.join(missing)}",
        )
    return paths


@lru_cache(maxsize=1)
def openvoice_converter():
    paths = require_openvoice_checkpoints()
    try:
        from openvoice.api import ToneColorConverter
    except ImportError:
        not_ready("OpenVoice V2", "Instale OpenVoice e MeloTTS pela tela Instalação e Diagnóstico.")
    device = os.getenv("OPENVOICE_DEVICE", "cpu")
    converter = ToneColorConverter(str(paths["converter_config"]), device=device)
    converter.load_ckpt(str(paths["converter_checkpoint"]))
    return converter


@lru_cache(maxsize=4)
def melo_tts(language: str):
    try:
        from melo.api import TTS
    except ImportError:
        not_ready("MeloTTS", "Instale OpenVoice e MeloTTS pela tela Instalação e Diagnóstico.")
    return TTS(language=language, device=os.getenv("OPENVOICE_DEVICE", "cpu"))


@app.post("/api/voice-clone/openvoice")
async def clone_openvoice(
    audio: UploadFile = File(...),
    text: str = Form(...),
    language: str = Form("en"),
    emotion: str = Form("neutro"),
    rhythm: float = Form(1.0),
    accent: str = Form("padrão"),
    consentConfirmed: bool = Form(...),
):
    require_engine("openvoice")
    if not consentConfirmed:
        raise HTTPException(403, {"code": "VOICE_CONSENT_REQUIRED", "message": "Use apenas vozes próprias ou autorizadas."})
    if not dependency_available("openvoice"):
        not_ready("OpenVoice V2", "Instale OpenVoice e MeloTTS pela tela Instalação e Diagnóstico.")
    language_code = {"en": "EN", "es": "ES", "fr": "FR", "zh": "ZH", "ja": "JP", "ko": "KR"}.get(language.lower())
    if not language_code:
        raise HTTPException(
            422,
            {
                "code": "OPENVOICE_LANGUAGE_UNSUPPORTED",
                "message": "O checkpoint oficial OpenVoice V2 não fornece voz-base em português.",
                "hint": "Neste adapter oficial, selecione inglês ou espanhol. XTTS-v2 é a opção do laboratório para texto em português.",
            },
        )
    if emotion.lower() not in {"neutro", "neutral"} or accent.lower() not in {"padrão", "padrao", "default"}:
        raise HTTPException(
            422,
            {
                "code": "OPENVOICE_STYLE_UNSUPPORTED",
                "message": "Este adapter oficial não aplica os controles de emoção/sotaque selecionados.",
                "hint": "Use estilo neutro e sotaque padrão; ritmo é aplicado pelo MeloTTS.",
            },
        )
    if not 0.7 <= rhythm <= 1.4:
        raise HTTPException(422, {"code": "OPENVOICE_RHYTHM_INVALID", "message": "Ritmo deve ficar entre 0,7 e 1,4."})

    reference_path = await save_upload(audio, "reference.wav")
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as source, tempfile.NamedTemporaryFile(
        suffix=".wav", delete=False
    ) as output:
        source_path, output_path = source.name, output.name
    try:
        import torch
        from openvoice import se_extractor

        paths = require_openvoice_checkpoints()
        converter = openvoice_converter()
        target_se, _audio_name = se_extractor.get_se(reference_path, converter, vad=True)
        model = melo_tts(language_code)
        speaker_ids = dict(model.hps.data.spk2id)
        if not speaker_ids:
            raise RuntimeError(f"MeloTTS não forneceu speakers para {language_code}.")
        speaker_key, speaker_id = next(iter(speaker_ids.items()))
        embedding_name = speaker_key.lower().replace("_", "-") + ".pth"
        source_embedding = paths["speaker_embeddings"] / embedding_name
        if not source_embedding.is_file():
            model_missing(
                "OpenVoice V2",
                f"embedding da voz-base '{embedding_name}' não encontrado.",
                f"Verifique o pacote checkpoints_v2 em {paths['root']}.",
            )
        source_se = torch.load(str(source_embedding), map_location=os.getenv("OPENVOICE_DEVICE", "cpu"), weights_only=True)
        model.tts_to_file(text[:5000], speaker_id, source_path, speed=rhythm)
        converter.convert(
            audio_src_path=source_path,
            src_se=source_se,
            tgt_se=target_se,
            output_path=output_path,
            message="Voice Lab: uso autorizado confirmado",
        )
        return Response(Path(output_path).read_bytes(), media_type="audio/wav")
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(500, {"code": "OPENVOICE_GENERATION_ERROR", "message": str(error)}) from error
    finally:
        Path(reference_path).unlink(missing_ok=True)
        Path(source_path).unlink(missing_ok=True)
        Path(output_path).unlink(missing_ok=True)


def resolve_rvc_model(requested: Optional[str]) -> Path:
    models = _rvc_models()
    if not models:
        model_missing(
            "RVC",
            "nenhum checkpoint autorizado (.pth) foi encontrado.",
            f"Coloque seu próprio modelo autorizado em {voice_lab_home() / 'models' / 'rvc'} ou configure RVC_MODEL_PATH no host.",
        )
    if requested:
        if Path(requested).name != requested:
            raise HTTPException(400, {"code": "RVC_MODEL_INVALID", "message": "Selecione apenas um nome de modelo reconhecido."})
        for model in models:
            if model.name == requested:
                return model
        raise HTTPException(404, {"code": "RVC_MODEL_NOT_FOUND", "message": f"Modelo RVC não reconhecido: {requested}"})
    if len(models) > 1:
        raise HTTPException(
            409,
            {
                "code": "RVC_MODEL_SELECTION_REQUIRED",
                "message": "Há mais de um modelo RVC instalado; selecione um modelo.",
                "models": [model.name for model in models],
            },
        )
    return models[0]


def rvc_executable() -> str:
    candidates = [
        Path(sys.prefix) / ("Scripts" if os.name == "nt" else "bin") / ("rvc.exe" if os.name == "nt" else "rvc"),
        Path(shutil.which("rvc") or ""),
    ]
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    not_ready("RVC", "A biblioteca foi importada, mas o executável 'rvc' não foi instalado no mesmo ambiente.")
    raise AssertionError("unreachable")


@app.post("/api/voice-conversion/rvc")
async def convert_rvc(
    audio: UploadFile = File(...),
    model: Optional[str] = Form(None),
    consentConfirmed: bool = Form(...),
):
    require_engine("rvc")
    if not consentConfirmed:
        raise HTTPException(403, {"code": "VOICE_CONSENT_REQUIRED", "message": "Use apenas vozes próprias ou autorizadas."})
    if not dependency_available("rvc"):
        not_ready("RVC", "Instale o runtime RVC pela tela Instalação e Diagnóstico.")
    checkpoint = resolve_rvc_model(model)
    input_path = await save_upload(audio, "input.wav")
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as output:
        output_path = output.name
    work_dir = Path(os.getenv("RVC_WORK_DIR", voice_lab_home() / "rvc-runtime"))
    work_dir.mkdir(parents=True, exist_ok=True)
    try:
        process = subprocess.run(
            [rvc_executable(), "infer", "-m", str(checkpoint), "-i", input_path, "-o", output_path],
            cwd=work_dir,
            capture_output=True,
            text=True,
            timeout=int(os.getenv("RVC_TIMEOUT_SECONDS", "900")),
            check=False,
        )
        if process.returncode != 0 or not Path(output_path).is_file() or Path(output_path).stat().st_size == 0:
            detail = (process.stderr or process.stdout or "RVC não gerou um arquivo de saída.").strip()
            raise HTTPException(
                500,
                {
                    "code": "RVC_INFERENCE_ERROR",
                    "message": detail[-3000:],
                    "hint": "Execute 'rvc init' no diretório de runtime uma vez para baixar os assets públicos exigidos pelo motor.",
                },
            )
        return Response(Path(output_path).read_bytes(), media_type="audio/wav")
    except subprocess.TimeoutExpired as error:
        raise HTTPException(504, {"code": "RVC_TIMEOUT", "message": "A inferência RVC excedeu o tempo limite local."}) from error
    finally:
        Path(input_path).unlink(missing_ok=True)
        Path(output_path).unlink(missing_ok=True)


class VoxtralTextRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=12000)
    system: str = Field(default="Responda com clareza no idioma do usuário.", max_length=4000)
    max_new_tokens: int = Field(default=500, ge=1, le=2048)


@lru_cache(maxsize=1)
def voxtral_components():
    try:
        from transformers import AutoProcessor, VoxtralForConditionalGeneration
    except ImportError:
        not_ready("Voxtral via Transformers", "Instale o motor Transformers pela tela Instalação e Diagnóstico.")
    model_id = os.getenv("VOXTRAL_MODEL_PATH") or "mistralai/Voxtral-Mini-3B-2507"
    processor = AutoProcessor.from_pretrained(model_id)
    model = VoxtralForConditionalGeneration.from_pretrained(
        model_id,
        torch_dtype="auto",
        device_map=os.getenv("VOXTRAL_DEVICE_MAP", "auto"),
    )
    return processor, model, model_id


def voxtral_generate(conversation: list[dict[str, Any]], max_new_tokens: int = 500) -> tuple[str, str]:
    processor, model, model_id = voxtral_components()
    inputs = processor.apply_chat_template(conversation)
    inputs = inputs.to(model.device)
    outputs = model.generate(**inputs, max_new_tokens=max_new_tokens)
    generated = outputs[:, inputs.input_ids.shape[1] :]
    decoded = processor.batch_decode(generated, skip_special_tokens=True)[0]
    return decoded, model_id


def _text_conversation(request: VoxtralTextRequest) -> list[dict[str, Any]]:
    content = request.prompt if not request.system else f"Instrução do sistema: {request.system}\n\nUsuário: {request.prompt}"
    return [{"role": "user", "content": [{"type": "text", "text": content}]}]


@app.post("/api/transformers/voxtral/text")
def voxtral_text(request: VoxtralTextRequest):
    require_engine("transformers")
    if not dependency_available("transformers"):
        not_ready("Voxtral via Transformers", "Instale o motor Transformers pela tela Instalação e Diagnóstico.")
    try:
        text, model_id = voxtral_generate(_text_conversation(request), request.max_new_tokens)
        return {"ok": True, "output_text": text, "model": model_id, "nativeAudioOutput": False}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(500, {"code": "VOXTRAL_GENERATION_ERROR", "message": str(error)}) from error


async def voxtral_from_audio(audio: UploadFile, prompt: str, max_new_tokens: int = 500):
    require_engine("transformers")
    if not dependency_available("transformers"):
        not_ready("Voxtral via Transformers", "Instale o motor Transformers pela tela Instalação e Diagnóstico.")
    path = await save_upload(audio, "input.wav")
    try:
        conversation = [
            {
                "role": "user",
                "content": [
                    {"type": "audio", "path": path},
                    {"type": "text", "text": prompt[:12000]},
                ],
            }
        ]
        text, model_id = voxtral_generate(conversation, max(1, min(max_new_tokens, 2048)))
        return JSONResponse({"ok": True, "output_text": text, "model": model_id, "nativeAudioOutput": False})
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(500, {"code": "VOXTRAL_AUDIO_ERROR", "message": str(error)}) from error
    finally:
        Path(path).unlink(missing_ok=True)


@app.post("/api/transformers/voxtral/audio")
async def voxtral_audio(
    audio: UploadFile = File(...),
    prompt: str = Form("Transcreva e descreva este áudio."),
    max_new_tokens: int = Form(500),
):
    return await voxtral_from_audio(audio, prompt, max_new_tokens)


@app.post("/api/transformers/voxtral/audio-to-audio")
async def voxtral_audio_to_audio(audio: UploadFile = File(...), prompt: str = Form("Responda com voz.")):
    # Os parâmetros fazem parte do contrato multipart, mas não são lidos porque
    # o checkpoint não possui decoder de áudio. Mantê-los evita uma falsa inferência.
    del audio, prompt
    unsupported(
        "Voxtral-Mini-3B-2507 aceita áudio e gera texto; não possui saída de áudio nativa neste adapter Transformers.",
        "Use o resultado textual com Piper, Kokoro, XTTS ou TTS do navegador. Isso continua sendo um pipeline por turnos.",
    )


# Rotas legadas permanecem como aliases de protocolo para clientes anteriores.
# Elas executam Voxtral; nenhuma delas carrega ou anuncia Qwen.
@app.post("/api/qwen-omni/text", include_in_schema=False)
def legacy_multimodal_text(request: VoxtralTextRequest):
    return voxtral_text(request)


@app.post("/api/qwen-omni/audio", include_in_schema=False)
async def legacy_multimodal_audio(
    audio: UploadFile = File(...), prompt: str = Form("Transcreva e descreva este áudio."), max_new_tokens: int = Form(500)
):
    return await voxtral_from_audio(audio, prompt, max_new_tokens)


@app.post("/api/qwen-omni/audio-to-audio", include_in_schema=False)
async def legacy_multimodal_audio_to_audio(audio: UploadFile = File(...), prompt: str = Form("Responda com voz.")):
    return await voxtral_audio_to_audio(audio, prompt)
