import { Check, Database, HardDrive, RefreshCw, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../services/apiClient";
import { Button, Field, Select, StatusMessage } from "./Controls";

interface AudioModelVariant {
  id: string;
  quantization: string;
  sizeBytes: number;
  sizeLabel: string;
  loaded: boolean;
  loadedInstanceIds: string[];
}

interface AudioModelGroup {
  familyId: string;
  displayName: string;
  publisher: string;
  architecture: string;
  params: string;
  format: string;
  audioEvidence: "runtime-capability" | "known-audio-family";
  variants: AudioModelVariant[];
}

interface DiscoveryPayload {
  models: AudioModelGroup[];
  totalAudioFamilies: number;
  totalAudioVariants: number;
  loadedAudioVariants: number;
  readOnly: boolean;
  note: string;
}

export function LmStudioModelPicker({
  baseUrl,
  onSelection,
}: {
  baseUrl: string;
  onSelection: (selection: { modelId: string; ready: boolean; loaded: boolean; sizeBytes: number } | null) => void;
}) {
  const [data, setData] = useState<DiscoveryPayload>();
  const [familyId, setFamilyId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const family = useMemo(() => data?.models.find((model) => model.familyId === familyId), [data, familyId]);
  const variant = useMemo(() => family?.variants.find((item) => item.id === variantId), [family, variantId]);

  const publish = useCallback((nextVariant: AudioModelVariant | undefined, nextConfirmed: boolean) => {
    if (!nextVariant) return onSelection(null);
    onSelection({
      modelId: nextVariant.id,
      ready: nextVariant.loaded || nextConfirmed,
      loaded: nextVariant.loaded,
      sizeBytes: nextVariant.sizeBytes,
    });
  }, [onSelection]);

  const chooseFamily = (models: AudioModelGroup[], nextFamilyId: string) => {
    const nextFamily = models.find((model) => model.familyId === nextFamilyId);
    if (!nextFamily) return;
    const nextVariant =
      nextFamily.variants.find((item) => item.loaded) ||
      nextFamily.variants.find((item) => /Q4_K_M/i.test(item.quantization)) ||
      nextFamily.variants[0];
    setFamilyId(nextFamily.familyId);
    setVariantId(nextVariant?.id || "");
    setConfirmed(Boolean(nextVariant?.loaded));
    publish(nextVariant, Boolean(nextVariant?.loaded));
  };

  const discover = useCallback(async () => {
    setLoading(true);
    setError("");
    onSelection(null);
    try {
      const response = await api<{ data: DiscoveryPayload }>(`/api/lmstudio/audio-models?baseUrl=${encodeURIComponent(baseUrl)}`);
      setData(response.data);
      const loadedFamily = response.data.models.find((model) => model.variants.some((item) => item.loaded));
      const preferred = loadedFamily || response.data.models[0];
      if (preferred) chooseFamily(response.data.models, preferred.familyId);
      else {
        setFamilyId("");
        setVariantId("");
        setConfirmed(false);
      }
    } catch (error) {
      setData(undefined);
      setError(error instanceof ApiError && error.hint ? `${error.message} — ${error.hint}` : error instanceof Error ? error.message : "Falha ao pesquisar modelos.");
    } finally {
      setLoading(false);
    }
  }, [baseUrl, onSelection, publish]);

  useEffect(() => {
    void discover();
    // A pesquisa inicial é somente-leitura. Alterar a URL exige clicar Atualizar,
    // evitando uma requisição a cada tecla digitada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFamily = (nextFamilyId: string) => {
    if (data) chooseFamily(data.models, nextFamilyId);
  };

  const handleVariant = (nextVariantId: string) => {
    const nextVariant = family?.variants.find((item) => item.id === nextVariantId);
    setVariantId(nextVariantId);
    setConfirmed(Boolean(nextVariant?.loaded));
    publish(nextVariant, Boolean(nextVariant?.loaded));
  };

  const confirm = () => {
    setConfirmed(true);
    publish(variant, true);
  };

  return (
    <section className="model-picker">
      <div className="model-picker-heading">
        <div>
          <span className="section-label">DESCOBERTA SEGURA DO LM STUDIO</span>
          <h3>Modelo de áudio e quantização</h3>
          <p>A consulta lê metadados locais e não carrega nenhum peso na memória.</p>
        </div>
        <Button variant="secondary" busy={loading} onClick={discover}><RefreshCw size={15} /> Atualizar lista</Button>
      </div>

      {error && <StatusMessage title="Não foi possível pesquisar o LM Studio">{error}</StatusMessage>}
      {data && data.models.length === 0 && (
        <StatusMessage title="Nenhum modelo de áudio compatível encontrado" type="info">
          O filtro é conservador e não considera apenas palavras de marketing. Baixe um Voxtral, Ultravox, MiniCPM-o ou outro modelo cuja ficha declare entrada de áudio.
        </StatusMessage>
      )}

      {data && data.models.length > 0 && (
        <>
          <div className="model-picker-summary">
            <span><Database size={14} /> {data.totalAudioFamilies} família(s)</span>
            <span><HardDrive size={14} /> {data.totalAudioVariants} quantização(ões)</span>
            <span className={data.loadedAudioVariants ? "is-loaded" : ""}><Check size={14} /> {data.loadedAudioVariants} carregada(s)</span>
          </div>
          <div className="form-grid">
            <Field label="Modelo compatível com áudio">
              <Select value={familyId} onChange={(event) => handleFamily(event.target.value)}>
                {data.models.map((model) => (
                  <option value={model.familyId} key={model.familyId}>
                    {model.displayName} · {model.params} {model.variants.some((item) => item.loaded) ? "· CARREGADO" : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Quantização disponível">
              <Select value={variantId} onChange={(event) => handleVariant(event.target.value)}>
                {family?.variants.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.quantization} · {item.sizeLabel} {item.loaded ? "· CARREGADA" : ""}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {variant?.loaded ? (
            <div className="model-load-state loaded"><Check size={17} /><div><strong>Já está carregado no LM Studio</strong><p>O Voice Lab usará a instância existente: <code>{variant.id}</code>.</p></div></div>
          ) : (
            <div className="model-load-state pending">
              <ShieldAlert size={19} />
              <div>
                <strong>{confirmed ? "Quantização confirmada" : "Confirme antes de permitir inferência"}</strong>
                <p>
                  O primeiro prompt pode fazer o LM Studio carregar somente <code>{variant?.id}</code>
                  {variant?.sizeLabel ? ` (${variant.sizeLabel})` : ""}. A pesquisa não carregou nenhum modelo.
                </p>
              </div>
              {!confirmed && <Button onClick={confirm}>Confirmar esta quantização</Button>}
            </div>
          )}
        </>
      )}
    </section>
  );
}
