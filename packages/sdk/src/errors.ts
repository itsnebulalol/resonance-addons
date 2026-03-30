export class AddonError extends Error {
  status: number;

  constructor(message: string, status: number = 400) {
    super(message);
    this.name = "AddonError";
    this.status = status;
  }
}
