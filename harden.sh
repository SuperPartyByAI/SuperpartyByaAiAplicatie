#!/bin/bash
set -euo pipefail

echo "==> START HARDENING"

if ! id aiops >/dev/null 2>&1; then
  echo "==> Creating aiops user"
  adduser --disabled-password --gecos "" aiops
  usermod -aG sudo aiops
fi

echo "==> Setting up SSH keys"
mkdir -p /home/aiops/.ssh
echo "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQDOx1YsW8iqufbMculr0tuSjrJZ8ZYXcEUPtQ3jPntmJ8cr77Jh1bwUWSxMdjMUoDaXo+gSJtMmQ57Wgk7JXHWvT+/UDDABtEc4w9xShrq0jKdF7LfP6tJvdOBH5TKQX3RgGFImNyr8ePqq3KrwfQ4KJZX8JCXxhaO4d37IZskUY/5rfsoeuXFZIkp+S/7X7Fx4D6Ud92ZWuhN0otNKf75zdVCMTI54YTB+r7FreiIvwzojfV8Rl1MVndX3djQeijVBcuGFBTC+fuUpuvXuxIyz5P+8+3BBP+I6w0WXBKXsnsYBTHnjQ5A7zVdy9GfyVYbkdz/9DS8vXkESqAGx6I8uc3f/dBzg9WPpfJFTMxCjPNiSS/5u65pyk2xYaNOdxw5AL1oUph689IltokZooVMXr307vMJC5iKa5e040olF14tulIM6l/DhjFxLuY+CgAZkyfnlkj5XHEq1SZG1ZJhCTAjxiW47CA/lGru3j0mVOJ53yw2H9wIBZXNetAL7TugSt6FYGOSw4t6Wcr2mNYs74nl5XyttbizZtXJb+dKjF7PoAxuulPzkuogYDyYRm7I+QYdLn1B+rxIwtSiRjFV5cYzwcZyJK1MK0y+7ida7s3akyvvxKV9V8JZkvRwSqQQstvyVQnStRdTt2gbtu3QNe/B2IRwcOihATeleqochYw== universparty@MacBook-Air-Ursache.local" > /home/aiops/.ssh/authorized_keys
chown -R aiops:aiops /home/aiops/.ssh
chmod 700 /home/aiops/.ssh
chmod 600 /home/aiops/.ssh/authorized_keys

echo "==> Granting passwordless sudo"
echo 'aiops ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/aiops

echo "==> Hardening sshd configuration"
sed -i 's/^#\?\s*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?\s*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config

echo "==> Locking root user"
passwd -d root
passwd -l root

echo "==> Restarting SSH securely"
nohup systemctl restart sshd >/dev/null 2>&1 &
echo "==> DONE"
