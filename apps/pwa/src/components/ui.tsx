import type { ButtonHTMLAttributes, ReactNode, InputHTMLAttributes, SelectHTMLAttributes } from 'react';

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Btn({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  return <button className={`btn ${variant} ${className}`.trim()} {...props} />;
}

export function Field({
  label,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string }) {
  return (
    <div className="field">
      {label && <label htmlFor={props.id}>{label}</label>}
      <input {...props} />
      {hint && <span className="muted">{hint}</span>}
    </div>
  );
}

export function SelectField({
  label,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <div className="field">
      {label && <label htmlFor={props.id}>{label}</label>}
      <select {...props}>{children}</select>
    </div>
  );
}

export function Alert({ kind, children }: { kind: 'error' | 'warn' | 'info'; children: ReactNode }) {
  return <div className={`alert ${kind}`}>{children}</div>;
}