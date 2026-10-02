import { useState, type FormEvent } from "react";
import type { Store } from "../../shared/api";
import { useChains, useSaveChain, useSaveStore } from "../queries";
import { ErrorText, Field } from "./ui";

const NEW_CHAIN = "__new__";

type Props = { store?: Store; onSaved: (id: number) => void; onCancel?: () => void };

/** Store with its chain; a new chain can be created inline. */
export function StoreForm({ store, onSaved, onCancel }: Props) {
  const chains = useChains();
  const saveChain = useSaveChain();
  const saveStore = useSaveStore();
  const [error, setError] = useState<unknown>(null);

  const [chainId, setChainId] = useState(store ? String(store.chainId) : "");
  const [newChain, setNewChain] = useState("");
  const [name, setName] = useState(store?.name ?? "");
  const [address, setAddress] = useState(store?.address ?? "");
  const [vatNumber, setVatNumber] = useState(store?.vatNumber ?? "");
  const busy = saveChain.isPending || saveStore.isPending;
  const noChains = chains.data?.length === 0;
  const chainChoice = noChains ? NEW_CHAIN : chainId;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const resolvedChainId =
        chainChoice === NEW_CHAIN ? (await saveChain.mutateAsync({ name: newChain })).id : Number(chainChoice);
      if (!resolvedChainId) return setError("Scegli la catena");
      const { id } = await saveStore.mutateAsync({ id: store?.id, chainId: resolvedChainId, name, address, vatNumber });
      onSaved(id);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      {!noChains && (
        <Field label="Catena">
          <select className="input" value={chainId} onChange={(e) => setChainId(e.target.value)} required>
            <option value="" disabled>
              Scegli…
            </option>
            {chains.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value={NEW_CHAIN}>+ Nuova catena…</option>
          </select>
        </Field>
      )}
      {chainChoice === NEW_CHAIN && (
        <Field label="Nome della catena" hint="es. Esselunga, Coop, Lidl, mercato">
          <input className="input" value={newChain} onChange={(e) => setNewChain(e.target.value)} required />
        </Field>
      )}
      <Field label="Punto vendita" hint="es. Milano Viale Piave">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <Field label="Indirizzo">
        <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="facoltativo" />
      </Field>
      <Field label="Partita IVA" hint="Serve a riconoscere il negozio dalla foto dello scontrino">
        <input className="input" value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} placeholder="facoltativa" inputMode="numeric" />
      </Field>
      <ErrorText error={error} />
      <div className="actions">
        {onCancel && (
          <button type="button" className="button" onClick={onCancel}>
            Annulla
          </button>
        )}
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? "Salvataggio…" : "Salva negozio"}
        </button>
      </div>
    </form>
  );
}
