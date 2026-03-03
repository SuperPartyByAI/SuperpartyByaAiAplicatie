#!/bin/bash
mkdir -p ~/.ssh
echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIM2E5zAzworekWUKJ6GzY3Dp7gR+OeQirkEaibRCsb6Z antigravity-deploy@superparty" >> ~/.ssh/authorized_keys
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
echo "REAL SSH KEY INJECTED SUCCESSFULLY!"
