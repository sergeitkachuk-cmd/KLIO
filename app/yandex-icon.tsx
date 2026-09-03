// Shared between /login and /signup's "Войти через Яндекс" buttons.
// .button svg (globals.css) sizes it to 18x18 automatically.
export default function YandexIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="10" fill="#FC3F1D" />
      <text x="10" y="14.5" textAnchor="middle" fontSize="12" fontWeight="700" fill="#fff" fontFamily="Arial, sans-serif">Я</text>
    </svg>
  );
}
