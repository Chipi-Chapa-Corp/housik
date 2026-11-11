type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function isField(target: EventTarget | null): target is Field {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement
  );
}

/** Keep native constraint errors visible after focus moves to another field. */
export function installValidation(document: Document) {
  const errors = new Map<Field, { message: HTMLSpanElement; invalid: string | null }>();
  let nextId = 0;
  let focusPending = false;
  let focusTimer: ReturnType<typeof setTimeout>;

  function clear(field: Field) {
    const error = errors.get(field);
    if (!error) return;
    const descriptions = (field.getAttribute('aria-describedby') || '')
      .split(/\s+/)
      .filter((id) => id && id !== error.message.id);
    if (descriptions.length) field.setAttribute('aria-describedby', descriptions.join(' '));
    else field.removeAttribute('aria-describedby');
    if (error.invalid === null) field.removeAttribute('aria-invalid');
    else field.setAttribute('aria-invalid', error.invalid);
    error.message.remove();
    errors.delete(field);
  }

  function validate(field: Field) {
    if (!field.willValidate || field.validity.valid) {
      clear(field);
      return;
    }
    let error = errors.get(field);
    if (!error) {
      const message = document.createElement('span');
      message.id = `field-error-${++nextId}`;
      message.className = 'field-error';
      const label = field.closest('label');
      // Exclude the error from the implicit label's name. aria-describedby still
      // exposes explicitly referenced text, including aria-hidden elements.
      if (label) message.setAttribute('aria-hidden', 'true');
      else message.setAttribute('role', 'alert');
      (label || field.parentElement)?.append(message);
      error = { message, invalid: field.getAttribute('aria-invalid') };
      errors.set(field, error);
      field.setAttribute(
        'aria-describedby',
        [field.getAttribute('aria-describedby'), message.id].filter(Boolean).join(' ')
      );
      field.setAttribute('aria-invalid', 'true');
    }
    error.message.textContent = field.validationMessage;
  }

  function blur(event: Event) {
    if (isField(event.target)) validate(event.target);
  }

  function edit() {
    // Let bindings update dependent constraints, such as a departure's min date.
    queueMicrotask(() => {
      for (const field of errors.keys()) {
        if (field.isConnected) validate(field);
        else clear(field);
      }
    });
  }

  function invalid(event: Event) {
    if (!isField(event.target)) return;
    event.preventDefault();
    validate(event.target);
    if (!focusPending) {
      const field = event.target;
      focusPending = true;
      // A task spans the whole native validation pass; browsers may run
      // microtasks between individual fields' invalid events.
      focusTimer = setTimeout(() => {
        focusPending = false;
        if (field.isConnected) field.focus();
      });
    }
  }

  function reset(event: Event) {
    if (!(event.target instanceof HTMLElement)) return;
    const container = event.target;
    for (const field of errors.keys()) if (container.contains(field)) clear(field);
  }

  document.addEventListener('focusout', blur);
  document.addEventListener('input', edit);
  document.addEventListener('change', edit);
  document.addEventListener('invalid', invalid, true);
  document.addEventListener('reset', reset);
  document.addEventListener('close', reset, true);
  const observer = new MutationObserver(() => {
    for (const field of errors.keys()) if (!field.isConnected) clear(field);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  return () => {
    clearTimeout(focusTimer);
    observer.disconnect();
    document.removeEventListener('focusout', blur);
    document.removeEventListener('input', edit);
    document.removeEventListener('change', edit);
    document.removeEventListener('invalid', invalid, true);
    document.removeEventListener('reset', reset);
    document.removeEventListener('close', reset, true);
    for (const field of errors.keys()) clear(field);
  };
}
