import { useState, type FormEvent } from "react";
import type { ProductGroup } from "../../shared/api";
import { useDeleteGroup, useGroups, useSaveGroup } from "../queries";
import { ConfirmButton, Dialog, ErrorText, Field } from "./ui";

function GroupForm({ group, onDone }: { group: ProductGroup; onDone: () => void }) {
  const save = useSaveGroup();
  const remove = useDeleteGroup();
  const [name, setName] = useState(group.name);
  const [error, setError] = useState<unknown>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutateAsync({ id: group.id, name }).then(onDone, setError);
  };
  return (
    <form className="form" onSubmit={submit}>
      <Field label="Nome del gruppo">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      {group.productCount > 0 && (
        <p className="muted small">Eliminando il gruppo, i suoi {group.productCount} prodotti restano ma senza gruppo.</p>
      )}
      <ErrorText error={error} />
      <div className="actions">
        <ConfirmButton label="Elimina" confirmLabel="Conferma" onConfirm={() => remove.mutateAsync(group.id).then(onDone, setError)} />
        <button type="submit" className="button primary" disabled={save.isPending}>
          Salva
        </button>
      </div>
    </form>
  );
}

/** Product groups (e.g. "Banane" = Chiquita + Coop + sfuse): rename or delete. New groups are created from the product form. */
export function GroupsSection() {
  const groups = useGroups();
  const [editing, setEditing] = useState<ProductGroup | null>(null);
  if (!groups.data?.length) return null;
  return (
    <section className="day groups">
      <h2 className="day-title">Gruppi</h2>
      <ul className="list">
        {groups.data.map((g) => (
          <li key={g.id}>
            <button type="button" className="list-item plain" onClick={() => setEditing(g)}>
              <span>{g.name}</span>
              <span className="muted small">{g.productCount} prodotti</span>
            </button>
          </li>
        ))}
      </ul>
      <Dialog open={editing != null} title="Modifica gruppo" onClose={() => setEditing(null)}>
        {editing && <GroupForm group={editing} onDone={() => setEditing(null)} />}
      </Dialog>
    </section>
  );
}
