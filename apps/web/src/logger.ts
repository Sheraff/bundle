export interface AppLogger {
  error: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
}

export const consoleLogger: AppLogger = {
  error: (...args) => {
    console.error(...args)
  },
  info: (...args) => {
    console.info(...args)
  },
  warn: (...args) => {
    console.warn(...args)
  },
}

export const noopLogger: AppLogger = {
  error: () => {},
  info: () => {},
  warn: () => {},
}

let appLogger: AppLogger = consoleLogger

export function getAppLogger() {
  return appLogger
}

export function setAppLoggerForTesting(logger: AppLogger | null) {
  appLogger = logger ?? consoleLogger
}
