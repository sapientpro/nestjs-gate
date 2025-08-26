import { ForbiddenException, HttpException } from '@nestjs/common';

export class GateResponse {
  /**
   * The HTTP response status code.
   */
  protected _status: number | null = null;

  /**
   * Get the HTTP status code.
   */
  public get status(): number | null {
    return this._status;
  }

  /**
   * Determine if the response was denied.
   */
  public get denied(): boolean {
    return !this.allowed;
  }

  /**
   *  Create a new response.
   */
  constructor(
    /**
     * Indicates whether the response was allowed.
     */
    public readonly allowed: boolean,
    /**
     * The response message.
     */
    public readonly message: string | null = null,
    /**
     * The response code.
     */
    public readonly code = null,
  ) {}

  /**
   * Create a new "allow" Response.
   */
  public static allow(message: string | null = null, code: any = null): GateResponse {
    return new GateResponse(true, message, code);
  }

  /**
   * Create a new "deny" Response.
   */
  public static deny(message: string | null = null, code: any = null): GateResponse {
    return new GateResponse(false, message, code);
  }

  /**
   * Create a new "deny" Response with a HTTP status code.
   */
  public static denyWithStatus(status: number, message: string | null = null, code: any = null): GateResponse {
    return GateResponse.deny(message, code).withStatus(status);
  }

  /**
   * Create a new "deny" Response with a 404 HTTP status code.
   */
  public static denyAsNotFound(message: string | null = null, code: any = null): GateResponse {
    return GateResponse.denyWithStatus(404, message, code);
  }

  /**
   * Throw authorization exception if response was denied.
   *
   * @throws {HttpException}
   */
  public authorize() {
    if (this.denied) {
      throw this._status ? new HttpException(this, this._status) : new ForbiddenException(this);
    }

    return this;
  }

  /**
   * Set the HTTP response status code.
   */
  public withStatus(status: number | null): this {
    this._status = status;

    return this;
  }

  /**
   * Set the HTTP response status code to 404.
   */
  public asNotFound() {
    return this.withStatus(404);
  }

  /**
   * Convert the response to a json object.
   */
  public toJSON() {
    return {
      allowed: this.allowed,
      message: this.message,
      code: this.code,
    };
  }

  /**
   * Get the string representation of the message.
   */
  public toString() {
    return this.message;
  }
}
