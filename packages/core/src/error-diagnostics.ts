import { dependencyErrorDiagnostics } from '../../db/error-diagnostics';
import { AppError } from './errors';

/** Content-free dependency diagnostics. Never copy messages, SQL, arbitrary
 * error names or properties from upstream failures into application logs. */
export function errorDiagnostics(error: unknown) {
  if (error instanceof AppError)
    return { error_type: 'AppError', error_code: error.code, error_status: error.status };
  return dependencyErrorDiagnostics(error);
}
