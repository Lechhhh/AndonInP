'use strict';
class PublicError extends Error {
    constructor(code, message, status = 400, retryAfter) {
        super(message); this.code = code; this.status = status; this.retryAfter = retryAfter;
    }
}
const denied = () => new PublicError('FORBIDDEN', 'Brak uprawnień do tej operacji.', 403);
module.exports = { PublicError, denied };
