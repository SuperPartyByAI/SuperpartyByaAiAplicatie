# 🗄️ Supabase REST Schema (OpenAPI)

> Documentație generată automat via OpenAPI REST din Supabase. Conține structura tabelelor publice și vizibile din perspectiva API-ului client.

## Tabel: `calls`

| Coloană | Tip Date | Format | Descriere |
| ------- | -------- | ------ | --------- |
| `id` | `string` | text | Note: This is a Primary Key.<pk/> |
| `from_number` | `string` | text |  |
| `to_number` | `string` | text |  |
| `direction` | `string` | text |  |
| `status` | `string` | text |  |
| `duration_seconds` | `integer` | integer |  |
| `recording_url` | `string` | text |  |
| `assigned_employee_id` | `string` | text |  |
| `created_at` | `string` | timestamp with time zone |  |

## Tabel: `employees`

| Coloană | Tip Date | Format | Descriere |
| ------- | -------- | ------ | --------- |
| `id` | `string` | text | Note: This is a Primary Key.<pk/> |
| `email` | `string` | text |  |
| `name` | `string` | text |  |
| `role` | `string` | text |  |
| `phone` | `string` | text |  |
| `status` | `string` | text |  |
| `created_at` | `string` | timestamp with time zone |  |
| `updated_at` | `string` | timestamp with time zone |  |

## Tabel: `app_inbox`

| Coloană | Tip Date | Format | Descriere |
| ------- | -------- | ------ | --------- |
| `id` | `string` | uuid | Note: This is a Primary Key.<pk/> |
| `title` | `string` | text |  |
| `body` | `string` | text |  |
| `type` | `string` | text |  |
| `source` | `string` | text |  |
| `read_by` | `array` | text[] |  |
| `created_at` | `string` | timestamp with time zone |  |

## Tabel: `wa_accounts`

| Coloană | Tip Date | Format | Descriere |
| ------- | -------- | ------ | --------- |
| `id` | `string` | text | Note: This is a Primary Key.<pk/> |
| `label` | `string` | text |  |
| `phone_number` | `string` | text |  |
| `state` | `string` | text |  |
| `ping_ms` | `integer` | integer |  |
| `messages_in` | `integer` | integer |  |
| `messages_out` | `integer` | integer |  |
| `recent_logs` | `any` | jsonb |  |
| `created_at` | `string` | timestamp with time zone |  |
| `updated_at` | `string` | timestamp with time zone |  |
| `last_ping_at` | `string` | timestamp with time zone |  |
| `connected_at` | `string` | timestamp with time zone |  |
| `needs_qr_since` | `string` | timestamp with time zone |  |
| `last_seen_at` | `string` | timestamp with time zone |  |

## Tabel: `wa_account_logs`

| Coloană | Tip Date | Format | Descriere |
| ------- | -------- | ------ | --------- |
| `id` | `string` | uuid | Note: This is a Primary Key.<pk/> |
| `wa_account_id` | `string` | text |  |
| `level` | `string` | text |  |
| `message` | `string` | text |  |
| `created_at` | `string` | timestamp with time zone |  |

## Tabel: `messages`

| Coloană | Tip Date | Format | Descriere |
| ------- | -------- | ------ | --------- |
| `id` | `string` | text | Note: This is a Primary Key.<pk/> |
| `conversation_id` | `string` | text | Note: This is a Foreign Key to `conversations.id`.<fk table='conversations' column='id'/> |
| `text` | `string` | text |  |
| `type` | `string` | text |  |
| `from_me` | `boolean` | boolean |  |
| `push_name` | `string` | text |  |
| `timestamp` | `integer` | bigint |  |
| `media_url` | `string` | text |  |
| `mimetype` | `string` | text |  |
| `created_at` | `string` | timestamp with time zone |  |

## Tabel: `conversations`

| Coloană | Tip Date | Format | Descriere |
| ------- | -------- | ------ | --------- |
| `id` | `string` | text | Note: This is a Primary Key.<pk/> |
| `jid` | `string` | text |  |
| `name` | `string` | text |  |
| `phone` | `string` | text |  |
| `account_id` | `string` | text |  |
| `account_label` | `string` | text |  |
| `client_id` | `string` | text |  |
| `last_message_at` | `integer` | bigint |  |
| `last_message_preview` | `string` | text |  |
| `photo_url` | `string` | text |  |
| `assigned_employee_id` | `string` | text |  |
| `assigned_employee_name` | `string` | text |  |
| `unread_count` | `integer` | integer |  |
| `is_group` | `boolean` | boolean |  |
| `created_at` | `string` | timestamp with time zone |  |
| `updated_at` | `string` | timestamp with time zone |  |

