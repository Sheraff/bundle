const byteFormatters = {
  byte: createUnitFormatter('byte', {
    maximumFractionDigits: 0,
  }),
  kilobyte: createUnitFormatter('kilobyte', {
    maximumFractionDigits: 1,
  }),
  megabyte: createUnitFormatter('megabyte', {
    maximumFractionDigits: 1,
  }),
}

export function formatBytes(value: number) {
  return formatByteValue(value, byteFormatters)
}

const signedByteFormatters = {
  byte: createUnitFormatter('byte', {
    maximumFractionDigits: 0,
    signDisplay: 'always',
  }),
  kilobyte: createUnitFormatter('kilobyte', {
    maximumFractionDigits: 1,
    signDisplay: 'always',
  }),
  megabyte: createUnitFormatter('megabyte', {
    maximumFractionDigits: 1,
    signDisplay: 'always',
  }),
}

export function formatSignedBytes(value: number) {
  return formatByteValue(value, signedByteFormatters)
}

const signedPercentFormatter = createPercentFormatter({
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: 'always',
})

export function formatSignedPercentage(value: number) {
  const normalizedValue = Object.is(value, -0) ? 0 : value
  return signedPercentFormatter(normalizedValue / 100)
}

export function shortSha(value: string) {
  return value.slice(0, 7)
}

function formatByteValue(
  value: number,
  formatters: {
    byte: (value: number) => string
    kilobyte: (value: number) => string
    megabyte: (value: number) => string
  },
) {
  const absoluteValue = Math.abs(value)

  if (absoluteValue >= 1024 * 1024) {
    return formatters.megabyte(value / (1024 * 1024))
  }

  if (absoluteValue >= 1024) {
    return formatters.kilobyte(value / 1024)
  }

  return formatters.byte(value)
}

function createUnitFormatter(
  unit: 'byte' | 'kilobyte' | 'megabyte',
  options: Intl.NumberFormatOptions,
) {
  const formatter = new Intl.NumberFormat(undefined, {
    ...options,
    style: 'unit',
    unit,
    unitDisplay: 'narrow',
  })

  return (value: number) => formatter.format(value)
}

function createPercentFormatter(options: Intl.NumberFormatOptions) {
  const formatter = new Intl.NumberFormat(undefined, {
    ...options,
    style: 'percent',
  })

  return (value: number) => formatter.format(value)
}
