export declare const ERROR_CODES: {
    readonly NOT_FOUND: "NOT_FOUND";
    readonly FORBIDDEN: "FORBIDDEN";
    readonly UNAUTHORIZED: "UNAUTHORIZED";
    readonly VALIDATION_ERROR: "VALIDATION_ERROR";
    readonly CONFLICT: "CONFLICT";
    readonly INTERNAL_ERROR: "INTERNAL_ERROR";
};
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
//# sourceMappingURL=error-codes.d.ts.map