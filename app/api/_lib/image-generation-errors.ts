// Only this locally defined failure is safe to show in the dialogue.
// Raw provider/storage errors must still go through the generic error handler.
export class ImageRelayUpgradeRequiredError extends Error {
  constructor() {
    super("Доработка с логотипом пока недоступна: сервер изображений ещё не обновлён.");
    this.name = "ImageRelayUpgradeRequiredError";
  }
}
