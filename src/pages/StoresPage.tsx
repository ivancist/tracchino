import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import type { Chain, Store } from "../../shared/api";
import { formatIsoDate } from "../../shared/dates";
import { StoreForm } from "../components/StoreForm";
import { ConfirmButton, Dialog, ErrorText, Field, PageHeader, QueryState } from "../components/ui";
import { useChains, useDeleteChain, useDeleteStore, useSaveChain, useStores } from "../queries";

function ChainForm({ chain, onDone }: { chain: Chain; onDone: () => void }) {
  const save = useSaveChain();
  const remove = useDeleteChain();
  const [name, setName] = useState(chain.name);
  const [error, setError] = useState<unknown>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutateAsync({ id: chain.id, name }).then(onDone, setError);
  };
  return (
    <form className="form" onSubmit={submit}>
      <Field label="Nome della catena">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <ErrorText error={error} />
      <div className="actions">
        {chain.storeCount === 0 && (
          <ConfirmButton label="Elimina" confirmLabel="Conferma" onConfirm={() => remove.mutateAsync(chain.id).then(onDone, setError)} />
        )}
        <button type="submit" className="button primary" disabled={save.isPending}>
          Salva
        </button>
      </div>
    </form>
  );
}

export function StoresPage() {
  const stores = useStores();
  const chains = useChains();
  const removeStore = useDeleteStore();
  const [editing, setEditing] = useState<Store | "new" | null>(null);
  const [editingChain, setEditingChain] = useState<Chain | null>(null);
  const [error, setError] = useState<unknown>(null);

  const byChain = (chains.data ?? []).map((chain) => ({
    chain,
    stores: (stores.data ?? []).filter((s) => s.chainId === chain.id),
  }));

  return (
    <>
      <PageHeader
        title="Negozi"
        back={
          <Link to="/altro" className="back" aria-label="Indietro">
            ‹
          </Link>
        }
        action={
          <button type="button" className="button primary" onClick={() => setEditing("new")}>
            + Nuovo
          </button>
        }
      />
      <QueryState isLoading={stores.isLoading || chains.isLoading} error={stores.error ?? chains.error} />
      {chains.data?.length === 0 && <p className="muted">Nessun negozio: aggiungine uno o crealo dallo scontrino.</p>}
      <ErrorText error={error} />
      {byChain.map(({ chain, stores: chainStores }) => (
        <section key={chain.id} className="day">
          <h2 className="day-title">
            <span>{chain.name}</span>
            <button type="button" className="link small" onClick={() => setEditingChain(chain)}>
              Modifica
            </button>
          </h2>
          <ul className="list">
            {chainStores.map((s) => (
              <li key={s.id} className="list-item">
                <span>
                  <strong>{s.name}</strong>
                  {s.address && <span className="muted small"> · {s.address}</span>}
                  <br />
                  <span className="muted small">
                    {s.receiptCount} scontrini{s.lastReceiptDate && ` · ultimo ${formatIsoDate(s.lastReceiptDate)}`}
                  </span>
                </span>
                <span className="actions">
                  <button type="button" className="link small" onClick={() => setEditing(s)}>
                    Modifica
                  </button>
                  {s.receiptCount === 0 && (
                    <ConfirmButton
                      label="Elimina"
                      confirmLabel="Conferma"
                      onConfirm={() => removeStore.mutateAsync(s.id).catch(setError)}
                    />
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <Dialog open={editing != null} title={editing === "new" ? "Nuovo negozio" : "Modifica negozio"} onClose={() => setEditing(null)}>
        {editing != null && (
          <StoreForm
            store={editing === "new" ? undefined : editing}
            onCancel={() => setEditing(null)}
            onSaved={() => setEditing(null)}
          />
        )}
      </Dialog>
      <Dialog open={editingChain != null} title="Modifica catena" onClose={() => setEditingChain(null)}>
        {editingChain && <ChainForm chain={editingChain} onDone={() => setEditingChain(null)} />}
      </Dialog>
    </>
  );
}
