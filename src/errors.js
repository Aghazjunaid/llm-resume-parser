// An error that carries its own HTTP status code.
// Throw it anywhere; the error handler in server.js turns it into a JSON response.
class AppError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

module.exports = { AppError };
