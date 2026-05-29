import type { HealthSpec, RestartPolicy, RestartSpec } from "@/lib/types";

const noAutoCorrect = {
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
  autoComplete: "off",
} as const;

export interface RestartHealthState {
  restartPolicy: RestartPolicy;
  restartMaxRetries: string;
  restartMaxBackoff: string;
  healthCmd: string;
  healthInterval: string;
  healthTimeout: string;
  healthRetries: string;
  healthStartupGrace: string;
}

export const emptyRestartHealthState: RestartHealthState = {
  restartPolicy: "never",
  restartMaxRetries: "",
  restartMaxBackoff: "",
  healthCmd: "",
  healthInterval: "",
  healthTimeout: "",
  healthRetries: "",
  healthStartupGrace: "",
};

interface Props {
  value: RestartHealthState;
  onChange: (next: RestartHealthState) => void;
  /** When true, show a banner explaining policy fields are ignored (smolfile source). */
  smolfileSourceSelected?: boolean;
}

export function RestartHealthEditor({
  value,
  onChange,
  smolfileSourceSelected,
}: Props) {
  const patch = (p: Partial<RestartHealthState>) => onChange({ ...value, ...p });
  const restartDisabled = value.restartPolicy === "never";
  const healthDisabled = !value.healthCmd.trim();

  return (
    <div className="space-y-3">
      {smolfileSourceSelected && (
        <div className="rounded-md border border-border bg-bg/50 px-2.5 py-1.5 text-xs text-fg-muted">
          A Smolfile source was selected — these fields are ignored here. Set{" "}
          <code>[restart]</code> and <code>[health]</code> directly in the
          Smolfile.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Restart policy" hint="how monitor reacts on exit">
          <select
            value={value.restartPolicy}
            onChange={(e) =>
              patch({ restartPolicy: e.target.value as RestartPolicy })
            }
            className="input"
          >
            <option value="never">never</option>
            <option value="always">always</option>
            <option value="on-failure">on-failure</option>
            <option value="unless-stopped">unless-stopped</option>
          </select>
        </Field>
        <Field
          label="Max retries"
          hint="blank = smolvm default; 0 = unlimited"
        >
          <input
            value={value.restartMaxRetries}
            onChange={(e) => patch({ restartMaxRetries: e.target.value })}
            placeholder="default"
            inputMode="numeric"
            disabled={restartDisabled}
            className="input disabled:opacity-50"
          />
        </Field>
        <Field label="Max backoff (s)" hint="cap on retry backoff">
          <input
            value={value.restartMaxBackoff}
            onChange={(e) => patch({ restartMaxBackoff: e.target.value })}
            placeholder="default"
            inputMode="numeric"
            disabled={restartDisabled}
            className="input disabled:opacity-50"
          />
        </Field>
      </div>

      <Field
        label="Health check command"
        hint={'runs as `sh -c "<cmd>"` inside the VM (blank = no check)'}
      >
        <input
          {...noAutoCorrect}
          value={value.healthCmd}
          onChange={(e) => patch({ healthCmd: e.target.value })}
          placeholder="curl -fsS http://127.0.0.1:8080/health"
          className="input font-mono"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Interval (s)" hint="between checks">
          <input
            value={value.healthInterval}
            onChange={(e) => patch({ healthInterval: e.target.value })}
            placeholder="10"
            inputMode="numeric"
            disabled={healthDisabled}
            className="input disabled:opacity-50"
          />
        </Field>
        <Field label="Timeout (s)" hint="per-check timeout">
          <input
            value={value.healthTimeout}
            onChange={(e) => patch({ healthTimeout: e.target.value })}
            placeholder="2"
            inputMode="numeric"
            disabled={healthDisabled}
            className="input disabled:opacity-50"
          />
        </Field>
        <Field label="Retries" hint="failures before unhealthy">
          <input
            value={value.healthRetries}
            onChange={(e) => patch({ healthRetries: e.target.value })}
            placeholder="3"
            inputMode="numeric"
            disabled={healthDisabled}
            className="input disabled:opacity-50"
          />
        </Field>
        <Field label="Startup grace (s)" hint="ignore failures during boot">
          <input
            value={value.healthStartupGrace}
            onChange={(e) => patch({ healthStartupGrace: e.target.value })}
            placeholder="20"
            inputMode="numeric"
            disabled={healthDisabled}
            className="input disabled:opacity-50"
          />
        </Field>
      </div>

      <p className="text-xs text-fg-muted">
        Policy is persisted into the VM record via a generated Smolfile. It
        only fires when something is actively running{" "}
        <code>smolvm machine monitor</code> against the VM.
      </p>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="text-xs text-fg-muted">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

function parseOptUInt(s: string): number | null | "invalid" {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isInteger(n) || n < 0) return "invalid";
  return n;
}

export function buildRestartSpec(state: RestartHealthState): RestartSpec | null {
  if (state.restartPolicy === "never") return null;
  const spec: RestartSpec = { policy: state.restartPolicy };
  const r = parseOptUInt(state.restartMaxRetries);
  if (typeof r === "number") spec.max_retries = r;
  const b = parseOptUInt(state.restartMaxBackoff);
  if (typeof b === "number") spec.max_backoff_secs = b;
  return spec;
}

export function buildHealthSpec(state: RestartHealthState): HealthSpec | null {
  const c = state.healthCmd.trim();
  if (!c) return null;
  const spec: HealthSpec = { exec: ["sh", "-c", c] };
  const i = parseOptUInt(state.healthInterval);
  if (typeof i === "number") spec.interval_secs = i;
  const t = parseOptUInt(state.healthTimeout);
  if (typeof t === "number") spec.timeout_secs = t;
  const r = parseOptUInt(state.healthRetries);
  if (typeof r === "number") spec.retries = r;
  const g = parseOptUInt(state.healthStartupGrace);
  if (typeof g === "number") spec.startup_grace_secs = g;
  return spec;
}

/** Returns an error message if any populated policy field failed to parse. */
export function validateRestartHealth(state: RestartHealthState): string | null {
  if (state.restartPolicy !== "never") {
    if (parseOptUInt(state.restartMaxRetries) === "invalid")
      return "Restart max retries must be a non-negative integer";
    if (parseOptUInt(state.restartMaxBackoff) === "invalid")
      return "Restart max backoff must be a non-negative integer (seconds)";
  }
  if (state.healthCmd.trim()) {
    if (parseOptUInt(state.healthInterval) === "invalid")
      return "Health interval must be a non-negative integer (seconds)";
    if (parseOptUInt(state.healthTimeout) === "invalid")
      return "Health timeout must be a non-negative integer (seconds)";
    if (parseOptUInt(state.healthRetries) === "invalid")
      return "Health retries must be a non-negative integer";
    if (parseOptUInt(state.healthStartupGrace) === "invalid")
      return "Health startup grace must be a non-negative integer (seconds)";
  }
  return null;
}
