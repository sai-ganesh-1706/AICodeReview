export function buildDiffPositionMap(patch: string): Map<number, number> {
  const map = new Map<number, number>();

  const lines = patch.split("\n");

  let newLine = 0;
  let position = 0;

  for (const line of lines) {
    // Parse hunk header
    if (line.startsWith("@@")) {
      const match = line.match(/\+(\d+)/);

      if (match) {
        newLine = parseInt(match[1], 10);
      }

      continue;
    }

    position++;

    // deleted line
    if (line.startsWith("-")) {
      continue;
    }

    // added line
    if (line.startsWith("+")) {
      map.set(newLine, position);
      newLine++;
      continue;
    }

    // context line
    newLine++;
  }

  return map;
}