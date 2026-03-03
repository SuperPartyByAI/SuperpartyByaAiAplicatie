const pty = require('node-pty');

const IP = '89.167.115.150';
const OLD_PASS = 'qnprPcARRmqv';
const NEW_PASS = 'SuperParty2026!'; // Default secure password for automation

console.log(`[+] Attempting interactive SSH login to ${IP}...`);

const ssh = pty.spawn('ssh', ['-o', 'StrictHostKeyChecking=no', `root@${IP}`], {
  name: 'xterm-color',
  cols: 80,
  rows: 30,
  cwd: process.env.HOME,
  env: process.env
});

let phase = 0;
let outputBuffer = '';

ssh.onData((data) => {
  outputBuffer += data;
  process.stdout.write(data);

  if (phase === 0 && data.includes('password:')) {
    console.log('\n[!] Entering initial password...');
    ssh.write(`${OLD_PASS}\r`);
    phase = 1;
  } 
  else if (phase === 1 && data.includes('Current password:')) {
    console.log('\n[!] Entering current password again for Hetzner reset...');
    ssh.write(`${OLD_PASS}\r`);
    phase = 2;
  }
  else if (phase === 2 && data.includes('New password:')) {
    console.log('\n[!] Submitting new permanent password...');
    ssh.write(`${NEW_PASS}\r`);
    phase = 3;
  }
  else if (phase === 3 && data.includes('Retype new password:')) {
    console.log('\n[!] Confirming new password...');
    ssh.write(`${NEW_PASS}\r`);
    phase = 4;
  }
  else if (phase === 4 && data.includes('root@')) {
    console.log('\n[+] Login & Reset Successful! Shell acquired. Proceeding to inject deployment payload...');
    
    // Once we see the bash prompt, we send the curl logic
    const cmd = `bash <(curl -s https://raw.githubusercontent.com/SuperPartyByAI/SuperpartyByaAiAplicatie/fix/clean-voip-firebase-20260303-AG/server/deploy_new_vps.sh)\r`;
    ssh.write(cmd);
    phase = 5;
  }
  else if (phase === 5 && data.includes('DEPLOYMENT COMPLETE!')) {
      console.log('\n[+] Automation finished successfully. Exiting.');
      ssh.write('exit\r');
      setTimeout(() => process.exit(0), 1000);
  }
});

ssh.onExit(({ exitCode, signal }) => {
    console.log(`\n[-] SSH Session Closed. Exit Code: ${exitCode}`);
    if (phase < 5) {
        console.error('[!] Failed to reach deployment completion phase.');
        process.exit(1);
    }
});

setTimeout(() => {
    console.error('\n[!] Automation timed out after 180 seconds.');
    ssh.kill();
    process.exit(1);
}, 180000);
