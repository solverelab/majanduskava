export const getArg = (name: string): string | undefined => {
  const argv = process.argv;
  const flag = `--${name}`;
  const idx = argv.indexOf(flag);
  if (idx === -1) return undefined;
  const val = argv[idx + 1];
  if (val === undefined || val.startsWith('--')) return undefined;
  return val;
};

export const requireArg = (name: string): string => {
  const v = getArg(name);
  if (!v) {
    console.error(`Puudub nõutav argument: --${name}`);
    process.exit(1);
  }
  return v;
};
