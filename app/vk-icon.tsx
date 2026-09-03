// Shared between /login and /signup's "Войти через VK" buttons.
// .button svg (globals.css) sizes it to 18x18 automatically.
export default function VkIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect width="20" height="20" rx="6" fill="#0077FF" />
      <text x="10" y="14.5" textAnchor="middle" fontSize="10.5" fontWeight="800" fill="#fff" fontFamily="Arial, sans-serif">VK</text>
    </svg>
  );
}
