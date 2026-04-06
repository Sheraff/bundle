export interface AppLogger {
  error: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
}

export const consoleLogger: AppLogger = {
  error: (...args) => {
    console.error(...args)
  },
  warn: (...args) => {
    console.warn(...args)
  },
}

export const noopLogger: AppLogger = {
  error: () => {},
  warn: () => {},
}

let appLogger: AppLogger = consoleLogger

export function getAppLogger() {
  return appLogger
}

export function setAppLoggerForTesting(logger: AppLogger | null) {
  appLogger = logger ?? consoleLogger
}
