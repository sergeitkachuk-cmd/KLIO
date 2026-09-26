type ListboxKeyboardInput = {
  key: string;
  shiftKey: boolean;
  preventDefault: () => void;
};

function getOptions(list: ParentNode | null): HTMLElement[] {
  return list ? Array.from(list.querySelectorAll<HTMLElement>('[role="option"]:not(:disabled)')) : [];
}

export function focusListboxOption(list: ParentNode | null, selectedValue?: string) {
  const options = getOptions(list);
  const selected = selectedValue === undefined
    ? undefined
    : options.find((option) => option.dataset.listboxValue === selectedValue);
  (selected || options[0])?.focus();
}

function focusAdjacentTo(trigger: HTMLElement | null | undefined, direction: -1 | 1) {
  if (!trigger) return;
  const focusable = Array.from(document.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0 && element.getAttribute("aria-hidden") !== "true");
  const next = focusable[focusable.indexOf(trigger) + direction];
  if (next) next.focus();
  else trigger.blur();
}

export function handleListboxKeyDown(
  event: ListboxKeyboardInput,
  list: ParentNode | null,
  close: () => void,
  trigger?: HTMLElement | null,
) {
  const options = getOptions(list);
  const currentIndex = options.indexOf(document.activeElement as HTMLElement);
  let nextIndex: number | null = null;

  if (event.key === "ArrowDown") nextIndex = currentIndex < 0 ? 0 : currentIndex + 1;
  else if (event.key === "ArrowUp") nextIndex = currentIndex < 0 ? options.length - 1 : currentIndex - 1;
  else if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = options.length - 1;
  else if (event.key === "Escape") {
    event.preventDefault();
    close();
    trigger?.focus();
    return;
  } else if (event.key === "Tab") {
    event.preventDefault();
    close();
    focusAdjacentTo(trigger, event.shiftKey ? -1 : 1);
    return;
  } else if (event.key === "Enter" || event.key === " ") {
    if (currentIndex >= 0) {
      event.preventDefault();
      options[currentIndex]?.click();
    }
    return;
  }

  if (nextIndex === null || !options.length) return;
  event.preventDefault();
  options[(nextIndex + options.length) % options.length]?.focus();
}
