export class CloseCoordinator {
  #approved = false
  #requestPending = false

  get canClose(): boolean {
    return this.#approved
  }

  request(): boolean {
    if (this.#approved || this.#requestPending) return false
    this.#requestPending = true
    return true
  }

  approve(): void {
    this.#approved = true
    this.#requestPending = false
  }

  cancel(): void {
    this.#requestPending = false
  }
}