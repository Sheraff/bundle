import "./hosted-synthetic-form.css"

export type HostedSyntheticFormInput = {
  scenarioSlug: string
  displayName: string
  sourceText: string
  budgetRawBytes?: number
  budgetGzipBytes?: number
  budgetBrotliBytes?: number
}

export function HostedSyntheticForm(props: {
  initial?: Partial<HostedSyntheticFormInput>
  submitLabel: string
  onSubmit: (input: HostedSyntheticFormInput) => Promise<void>
}) {
  return (
    <form
      className="hosted-synthetic-form"
      onSubmit={async (event) => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        await props.onSubmit({
          scenarioSlug: String(form.get("scenarioSlug") ?? ""),
          displayName: String(form.get("displayName") ?? ""),
          sourceText: String(form.get("sourceText") ?? ""),
          budgetRawBytes: optionalNumber(form.get("budgetRawBytes")),
          budgetGzipBytes: optionalNumber(form.get("budgetGzipBytes")),
          budgetBrotliBytes: optionalNumber(form.get("budgetBrotliBytes")),
        })
      }}
    >
      <label>
        Scenario id
        <input name="scenarioSlug" required defaultValue={props.initial?.scenarioSlug} />
      </label>
      <label>
        Display name
        <input name="displayName" required defaultValue={props.initial?.displayName} />
      </label>
      <label>
        Raw ESM source
        <textarea
          name="sourceText"
          required
          rows={16}
          defaultValue={props.initial?.sourceText ?? "export default async function scenario() {\n  return import('./src/main.ts')\n}\n"}
        />
      </label>
      <fieldset>
        <legend>Initial budget intent</legend>
        <label>
          Raw bytes
          <input name="budgetRawBytes" type="number" min="0" defaultValue={props.initial?.budgetRawBytes ?? ""} />
        </label>
        <label>
          Gzip bytes
          <input name="budgetGzipBytes" type="number" min="0" defaultValue={props.initial?.budgetGzipBytes ?? ""} />
        </label>
        <label>
          Brotli bytes
          <input name="budgetBrotliBytes" type="number" min="0" defaultValue={props.initial?.budgetBrotliBytes ?? ""} />
        </label>
      </fieldset>
      <button type="submit">{props.submitLabel}</button>
    </form>
  )
}

function optionalNumber(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim()
  return text.length === 0 ? undefined : Number(text)
}
