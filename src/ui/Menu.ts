/**
 * Dropdown menus for the footer controls. A menu is any `[data-menu]` element holding one `.menu__toggle` button and one
 * `.menu__panel`; the panel opens upward because the controls sit at the bottom of the page. A click on anything inside the panel
 * marked `[data-menu-close]` closes it (action items), while checkboxes and the like leave it open so several can be changed at once.
 */
export function setupMenus(root: ParentNode = document): void {
  const menus = [...root.querySelectorAll<HTMLElement>('[data-menu]')];

  const setOpen = (menu: HTMLElement, open: boolean): void => {
    const toggle = menu.querySelector<HTMLButtonElement>('.menu__toggle');
    const panel = menu.querySelector<HTMLElement>('.menu__panel');
    if (!toggle || !panel) return;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.classList.toggle('selected', open);
    // A button left focused would eat the next Space press and show a stuck highlight.
    if (!open) toggle.blur();
  };
  const closeAll = (except?: HTMLElement): void => { for (const menu of menus) if (menu !== except) setOpen(menu, false); };

  for (const menu of menus) {
    const toggle = menu.querySelector<HTMLButtonElement>('.menu__toggle');
    const panel = menu.querySelector<HTMLElement>('.menu__panel');
    if (!toggle || !panel) continue;
    toggle.setAttribute('aria-haspopup', 'true');
    setOpen(menu, false);
    toggle.addEventListener('click', () => { const open = panel.hidden !== false; closeAll(menu); setOpen(menu, open); });
    panel.addEventListener('click', (event) => { if ((event.target as HTMLElement).closest('[data-menu-close]')) setOpen(menu, false); });
  }

  document.addEventListener('pointerdown', (event) => { if (!(event.target as HTMLElement).closest('[data-menu]')) closeAll(); });
  window.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeAll(); });
  // A modal dialog (history, batch) takes over the screen, so nothing should stay open behind it.
  window.addEventListener('blur', () => closeAll());
}
