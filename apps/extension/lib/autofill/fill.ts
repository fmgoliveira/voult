/** Set a value the way a user would, so React/Vue/Angular notice the change. */
export function setFieldValue(el: HTMLInputElement, value: string): void {
  const proto = Object.getPrototypeOf(el) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  el.focus({ preventScroll: true });
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
}

/** Fill a single OTP box, or one digit per box for split inputs. */
export function fillOtp(inputs: HTMLInputElement[], code: string): void {
  if (inputs.length === 1) return setFieldValue(inputs[0]!, code);
  inputs.forEach((input, i) => {
    if (code[i]) setFieldValue(input, code[i]!);
  });
}
