#!/bin/bash
mkdir -p ~/.ssh
echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBCrq+1CeoKYvaPpostAT5P9YxZ4SaypkLHGO5AT1Wm4 antigravity_deploy" >> ~/.ssh/authorized_keys
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
echo "SSH KEY INJECTED SUCCESSFULLY!"
