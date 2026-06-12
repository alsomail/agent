import type { ModelInfo } from "@myagent/protocol";
import { useEffect, useRef, useState } from "react";
import { fetchModels } from "../../api/client.js";
import { ANTHROPIC_MODELS } from "../../lib/provider-models.js";

interface Props {
  provider: string;
  selected: string;
  onSelect: (modelName: string) => void;
  disabled?: boolean;
}

export default function ModelSelector({ provider, selected, onSelect, disabled = false }: Props) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 用 ref 保持最新的 selected/onSelect 引用，避免 useEffect 依赖它们
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (provider === "ollama") {
      setLoading(true);
      setError(null);
      fetchModels("ollama")
        .then((list) => {
          setModels(list);
          // 自动选择第一个
          if (list.length > 0 && !selectedRef.current) {
            onSelectRef.current(list[0].name);
          }
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : "获取模型列表失败");
          setModels([]);
        })
        .finally(() => setLoading(false));
    } else if (provider === "anthropic") {
      setModels(ANTHROPIC_MODELS);
      if (!selectedRef.current || !ANTHROPIC_MODELS.find((m) => m.name === selectedRef.current)) {
        onSelectRef.current(ANTHROPIC_MODELS[0].name);
      }
    }
  }, [provider]); // 仅在 provider 变化时重新拉取

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <label
        htmlFor="model-select"
        style={{ fontSize: 13, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}
      >
        模型:
      </label>
      {loading ? (
        <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>加载中...</span>
      ) : error ? (
        <span style={{ fontSize: 12, color: "var(--color-warning)" }} title={error}>
          ⚠ 无法连接 Ollama. 请先运行: ollama serve
        </span>
      ) : (
        <select
          id="model-select"
          value={selected}
          disabled={disabled}
          onChange={(e) => onSelect(e.target.value)}
          style={{
            padding: "4px 8px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            color: "var(--color-text)",
            fontSize: 13,
            outline: "none",
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.7 : 1,
            maxWidth: 180,
          }}
        >
          {models.map((m) => (
            <option key={m.name} value={m.name}>
              {m.displayName}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
