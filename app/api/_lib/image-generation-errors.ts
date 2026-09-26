// Only this locally defined failure is safe to show in the dialogue.
// Raw provider/storage errors must still go through the generic error handler.
export class ImageRelayUpgradeRequiredError extends Error {
  constructor(message = "Доработка с логотипом пока недоступна: сервер изображений ещё не обновлён.") {
    super(message);
    this.name = "ImageRelayUpgradeRequiredError";
  }
}

export class ImageInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageInputError";
  }
}
