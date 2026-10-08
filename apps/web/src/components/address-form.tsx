"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, MapPin } from "lucide-react";
import { Button, Input, Label } from "@solarsaathi/ui";
import { saveAddressDraft, validateAddress } from "../lib/address-draft";

export function AddressForm({ initialAddress = "", compact = false, onSaved }: { initialAddress?: string; compact?: boolean; onSaved?: (address: string) => void }) {
  const id = useId();
  const router = useRouter();
  const [address, setAddress] = useState(initialAddress);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateAddress(address);
    if (validation) { setError(validation); return; }
    try {
      saveAddressDraft(sessionStorage, address);
      setError(undefined);
      if (onSaved) { onSaved(address.trim()); return; }
      setPending(true);
      router.push("/app/analyze");
    } catch {
      setError("Your browser could not save this draft. Allow session storage, then try again.");
    }
  }
  return (
    <form onSubmit={submit} noValidate className={`address-form ${compact ? "address-form-compact" : ""}`}>
      <Label htmlFor={id}>Your property address</Label>
      <div className="address-controls">
        <div className="address-input-wrap">
          <MapPin size={20} aria-hidden="true" />
          <Input id={id} name="address" autoComplete="street-address" placeholder="Building, street, city or PIN code" value={address} maxLength={301}
            onChange={event => { setAddress(event.target.value); setError(undefined); }} aria-invalid={Boolean(error)} aria-describedby={`${id}-hint ${error ? `${id}-error` : ""}`} disabled={pending} />
        </div>
        <Button type="submit" disabled={pending}>{pending ? "Opening your workspace…" : "Start planning"}<ArrowRight aria-hidden="true" /></Button>
      </div>
      <p id={`${id}-hint`} className="form-hint">Draft saved only in this browser tab. Nothing is sent for analysis yet.</p>
      {error && <p id={`${id}-error`} role="alert" className="form-error">{error}</p>}
    </form>
  );
}
