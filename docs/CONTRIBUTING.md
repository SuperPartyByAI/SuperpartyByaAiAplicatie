# CONTRIBUTING — Politica de Release Superparty

## Regula de aur — fără excepții

```
branch → PR → CI verde → merge
```

**Niciodată:**

- ❌ push direct pe `main`
- ❌ merge fără CI verde
- ❌ patch live pe VPS
- ❌ bypass branch protection

---

## De ce branch protection este acum enforce-uită complet

Branch `main` are **enforce_admins = true** — inclusiv adminii sunt blocați.

Orice încercare de push direct pe `main` returnează:

```
remote: error: GH006: Protected branch update failed for refs/heads/main.
remote: - Required status checks have not run.
remote: - Changes must be made through a pull request.
```

---

## Fluxul corect pentru orice schimbare

```bash
# 1. Branch nou
git checkout -b fix/descriere-scurta

# 2. Schimbări + commit
git add ...
git commit -m "fix: descriere"

# 3. Push branch (nu main)
git push origin fix/descriere-scurta

# 4. Deschide PR pe GitHub
# 5. Asteapta CI verde (3 checks obligatorii)
# 6. Merge prin GitHub UI

# 7. Deploy prin script oficial
bash scripts/deploy_wa.sh    # pentru WhatsApp
bash scripts/deploy_voice.sh # pentru Voice
```

---

## Branch protection — config finală

| Regulă                      | Status                  |
| --------------------------- | ----------------------- |
| enforce_admins              | ✅ True — niciun bypass |
| PR required before merge    | ✅ True                 |
| WA Outbox Validation CI     | ✅ Obligatoriu          |
| Voice Endpoints Smoke CI    | ✅ Obligatoriu          |
| JS Syntax Check CI          | ✅ Obligatoriu          |
| Strict (up to date cu main) | ✅ True                 |
| Force push                  | ❌ Blocat               |
| Delete branch               | ❌ Blocat               |
| Linear history              | ✅ True                 |

---

## Pași pre-PR (checklist local)

```bash
git status                     # curat?
git diff main                  # ce ai schimbat exact?
node --check <fisier>.mjs      # syntax ok?
grep -r "hardcoded" . | grep -v ".git"  # fara secrete?
```

---

## Deploy după merge

- Folosești DOAR `scripts/deploy_wa.sh` sau `scripts/deploy_voice.sh`
- Niciodată `nano` pe server, `scp` manual sau restart fără script

---

## Smoke post-deploy (obligatoriu)

```bash
curl -sf https://wa.superparty.ro/health
curl -sf https://voice.superparty.ro/health
```

Dacă health nu e `{"status":"ok"}` → **rollback imediat**.

---

## Rollback

```bash
# WA
git log --oneline -5                    # identifica SHA anterior
git checkout <SHA> -- whatsapp-*.js
pm2 reload whatsapp-integration-v6

# Voice
docker stop superparty-voice
# rebuild cu SHA anterior — vezi docs/RELEASE_CHECKLIST.md
```

---

## Referință completă

→ [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) — procesul complet de 10 pași cu comenzi reale
