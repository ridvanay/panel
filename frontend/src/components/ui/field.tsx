import type { ReactNode } from "react";

interface FieldInputProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}

interface FieldProps {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: (inputProps: FieldInputProps) => ReactNode;
}

/**
 * Label/input/hata mesajını `aria-describedby` ve `aria-invalid` ile doğru şekilde
 * ilişkilendirir. `children` bir render-prop: hesaplanan a11y prop'larını doğrudan
 * input'a geçirmeniz gerekir — bu, gizli `cloneElement` sihrinden daha açık ve güvenlidir.
 */
export function Field({ id, label, error, hint, required, children }: FieldProps) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label}
        {required && (
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-foreground/60">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
