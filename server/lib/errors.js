// Typed errors so routes can map failures to the right HTTP status + code.
class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

module.exports = { ApiError };
