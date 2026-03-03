#!/bin/expect
set timeout 180
set password "qnprPcARRmqv"
set newpass "SuperParty2026!"
set ip "89.167.115.150"

spawn ssh -o StrictHostKeyChecking=no root@$ip
expect {
    "Password:" {
        send "$password\r"
        exp_continue
    }
    "Current password:" {
        send "$password\r"
        exp_continue
    }
    "New password:" {
        send "$newpass\r"
        exp_continue
    }
    "Retype new password:" {
        send "$newpass\r"
        exp_continue
    }
    "# " {
        send "bash <(curl -s https://raw.githubusercontent.com/SuperPartyByAI/SuperpartyByaAiAplicatie/fix/clean-voip-firebase-20260303-AG/server/deploy_new_vps.sh)\r"
        expect "DEPLOYMENT COMPLETE!"
        send "exit\r"
    }
}
