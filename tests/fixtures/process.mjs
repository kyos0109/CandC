const scenario = process.argv[2];
if (scenario === 'fragmented') {
  process.stdout.write('{"text":"first');
  setTimeout(() => {
    process.stdout.write('"}\r\n{"text":"second"}\n');
    process.exitCode = 0;
  }, 10);
} else if (scenario === 'invalid') {
  process.stdout.write('not-json\n');
} else if (scenario === 'partial') {
  process.stdout.write('{"incomplete":');
} else if (scenario === 'failed') {
  process.stdout.write('{"result":"looks successful"}\n');
  setTimeout(() => { process.exitCode = 7; }, 50);
} else if (scenario === 'wait') {
  process.stdout.write('{"ready":true}\n');
  setInterval(() => undefined, 1_000);
} else if (scenario === 'echo') {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => { process.stdout.write(JSON.stringify({ input }) + '\n'); });
}
