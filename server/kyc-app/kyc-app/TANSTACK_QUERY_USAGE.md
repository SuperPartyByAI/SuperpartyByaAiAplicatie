# TanStack Query Usage Guide

## ✅ Ce Am Implementat

TanStack Query (React Query) pentru automatic caching și data synchronization.

**Fișiere create:**

- `src/queryClient.js` - Query client configuration
- `src/hooks/useEvents.js` - Events hooks
- `src/hooks/useWhatsApp.js` - WhatsApp hooks
- `src/hooks/useProfile.js` - User profile hooks
- `src/main.jsx` - Updated with QueryClientProvider

---

## 🚀 Cum Să Folosești

### 1. Fetch Data (Query)

```javascript
import { useEvents } from '../hooks/useEvents';

function EvenimenteScreen() {
  const { data: events, isLoading, error, refetch } = useEvents();

  if (isLoading) {
    return <LoadingSpinner message="Se încarcă evenimentele..." />;
  }

  if (error) {
    return <ErrorMessage error={error} onRetry={refetch} />;
  }

  return (
    <div>
      {events?.map(event => (
        <EventCard key={event.id} event={event} />
      ))}
    </div>
  );
}
```

**Beneficii:**

- Prima vizită: loading spinner
- A doua vizită: INSTANT (din cache!)
- Auto-refetch în background pentru date fresh

---

### 2. Create Data (Mutation)

```javascript
import { useCreateEvent } from '../hooks/useEvents';

function CreateEventForm() {
  const createEvent = useCreateEvent();

  const handleSubmit = async formData => {
    try {
      await createEvent.mutateAsync(formData);
      // Success! Events list se actualizează automat
      alert('Eveniment creat cu succes!');
    } catch (error) {
      alert('Eroare: ' + error.message);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* form fields */}
      <button type="submit" disabled={createEvent.isPending}>
        {createEvent.isPending ? 'Se creează...' : 'Creează Eveniment'}
      </button>
    </form>
  );
}
```

---

### 3. Update Data (Mutation cu Optimistic Update)

```javascript
import { useUpdateProfile } from '../hooks/useProfile';

function ProfileSettings({ userId }) {
  const updateProfile = useUpdateProfile();

  const handleUpdate = async newData => {
    try {
      await updateProfile.mutateAsync({
        userId,
        data: newData,
      });
      // UI se actualizează INSTANT (optimistic update)
      // Apoi se sincronizează cu serverul
    } catch (error) {
      // Rollback automat dacă eroare
      alert('Eroare: ' + error.message);
    }
  };

  return (
    <div>
      <button onClick={() => handleUpdate({ theme: 'dark' })}>Schimbă tema</button>
    </div>
  );
}
```

---

### 4. Real-time Data (Auto-refetch)

```javascript
import { useConversations } from '../hooks/useWhatsApp';

function WhatsAppConversations() {
  // Auto-refetch la fiecare 30 secunde
  const { data: conversations } = useConversations();

  return (
    <div>
      {conversations?.map(conv => (
        <ConversationItem key={conv.id} conversation={conv} />
      ))}
    </div>
  );
}
```

**Beneficii:**

- Datele se actualizează automat la fiecare 30s
- Fără cod extra pentru polling
- Cache între refetch-uri

---

### 5. Conditional Queries

```javascript
import { useEvent } from '../hooks/useEvents';

function EventDetails({ eventId }) {
  // Query rulează doar dacă eventId există
  const { data: event, isLoading } = useEvent(eventId);

  if (!eventId) {
    return <p>Selectează un eveniment</p>;
  }

  if (isLoading) {
    return <LoadingSpinner />;
  }

  return <EventCard event={event} />;
}
```

---

## 📊 Available Hooks

### Events

```javascript
import {
  useEvents, // Fetch all events
  useEvent, // Fetch single event
  useCreateEvent, // Create event
  useUpdateEvent, // Update event
  useDeleteEvent, // Delete event
} from '../hooks/useEvents';
```

### WhatsApp

```javascript
import {
  useConversations, // Fetch conversations (auto-refetch 30s)
  useMessages, // Fetch messages (auto-refetch 10s)
  useWhatsAppAccounts, // Fetch accounts
  useSendMessage, // Send message
  useWhatsAppQR, // Get QR code (auto-refetch 5s)
} from '../hooks/useWhatsApp';
```

### Profile

```javascript
import {
  useProfile, // Fetch user profile
  useUpdateProfile, // Update profile (optimistic)
  useCreateProfile, // Create profile
} from '../hooks/useProfile';
```

---

## 🎯 Patterns

### Loading States

```javascript
const { data, isLoading, isFetching, error } = useEvents();

// isLoading: true doar prima dată (no cache)
// isFetching: true când face refetch în background
// error: eroare dacă query failed

if (isLoading) return <LoadingSpinner />;
if (error) return <ErrorMessage error={error} />;

return (
  <div>
    {isFetching && <RefreshIndicator />}
    {data?.map(item => (
      <Item key={item.id} item={item} />
    ))}
  </div>
);
```

---

### Manual Refetch

```javascript
const { data, refetch } = useEvents();

return (
  <div>
    <button onClick={() => refetch()}>Reîmprospătează</button>
    {data?.map(item => (
      <Item key={item.id} item={item} />
    ))}
  </div>
);
```

---

### Dependent Queries

```javascript
function EventWithDetails({ eventId }) {
  // First query
  const { data: event } = useEvent(eventId);

  // Second query depends on first
  const { data: participants } = useQuery({
    queryKey: ['participants', event?.id],
    queryFn: () => fetchParticipants(event.id),
    enabled: !!event, // Only run if event exists
  });

  return <div>...</div>;
}
```

---

### Prefetching

```javascript
import { useQueryClient } from '@tanstack/react-query';

function EventsList() {
  const queryClient = useQueryClient();
  const { data: events } = useEvents();

  const handleMouseEnter = eventId => {
    // Prefetch event details on hover
    queryClient.prefetchQuery({
      queryKey: ['events', eventId],
      queryFn: () => fetchEvent(eventId),
    });
  };

  return (
    <div>
      {events?.map(event => (
        <div key={event.id} onMouseEnter={() => handleMouseEnter(event.id)}>
          {event.title}
        </div>
      ))}
    </div>
  );
}
```

---

## 🔧 Configuration

### Adjust Stale Time

```javascript
// În hook
const { data } = useQuery({
  queryKey: ['events'],
  queryFn: fetchEvents,
  staleTime: 10 * 60 * 1000, // 10 minutes
});

// Sau global în queryClient.js
staleTime: 5 * 60 * 1000, // 5 minutes default
```

**Recomandări:**

- Frequently changing data (messages): 10-30 seconds
- Moderately changing data (events): 5 minutes
- Rarely changing data (profile): 10 minutes
- Static data (config): Infinity

---

### Disable Auto-refetch

```javascript
const { data } = useQuery({
  queryKey: ['events'],
  queryFn: fetchEvents,
  refetchOnWindowFocus: false,
  refetchOnMount: false,
  refetchOnReconnect: false,
});
```

---

### Retry Logic

```javascript
const { data } = useQuery({
  queryKey: ['events'],
  queryFn: fetchEvents,
  retry: (failureCount, error) => {
    // Don't retry on 404
    if (error.status === 404) return false;

    // Retry up to 3 times
    return failureCount < 3;
  },
  retryDelay: attemptIndex => {
    // Exponential backoff
    return Math.min(1000 * 2 ** attemptIndex, 30000);
  },
});
```

---

## 🐛 Debugging

### React Query DevTools

DevTools sunt deja activate în development mode!

**Cum să folosești:**

1. Deschide aplicația în browser
2. Caută iconița React Query în colțul din dreapta jos
3. Click pentru a deschide DevTools
4. Vezi toate queries și starea lor

**Ce poți face:**

- Vezi toate queries active
- Vezi cache data
- Trigger manual refetch
- Invalidate queries
- Vezi query status (loading, success, error)

---

### Console Logging

```javascript
const { data, isLoading, error } = useQuery({
  queryKey: ['events'],
  queryFn: fetchEvents,
  onSuccess: data => {
    console.log('✅ Events loaded:', data);
  },
  onError: error => {
    console.error('❌ Events error:', error);
  },
});
```

---

## 📈 Expected Results

### Before TanStack Query:

```
Pagina Evenimente:
- Request 1: 500ms (Supabase read)
- Navighează la Chat
- Navighează înapoi la Evenimente
- Request 2: 500ms (Supabase read DIN NOU!)
- Total: 1000ms
- Supabase reads: 2
```

### After TanStack Query:

```
Pagina Evenimente:
- Request 1: 500ms (Supabase read + cache)
- Navighează la Chat
- Navighează înapoi la Evenimente
- Request 2: 50ms (INSTANT din cache!)
- Total: 550ms (45% mai rapid!)
- Supabase reads: 1 (50% reducere!)
```

---

## 💰 Cost Savings

### Scenario: 100 utilizatori activi

**Before:**

- 100 users × 50 page views/day × 10 Supabase reads/page = 50,000 reads/day
- 1,500,000 reads/month
- Cost: ~$7.50/month

**After:**

- 100 users × 50 page views/day × 3 Supabase reads/page = 15,000 reads/day
- 450,000 reads/month
- Cost: ~$2.25/month

**Savings: $5.25/month = $63/year** (70% reduction!)

---

## 🎯 Migration Guide

### Step 1: Identifică componentele cu data fetching

```javascript
// Before
function EvenimenteScreen() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchEvents().then(data => {
      setEvents(data);
      setLoading(false);
    });
  }, []);

  // ...
}
```

### Step 2: Înlocuiește cu hook

```javascript
// After
import { useEvents } from '../hooks/useEvents';

function EvenimenteScreen() {
  const { data: events, isLoading } = useEvents();

  // ...
}
```

### Step 3: Testează

- Verifică că datele se încarcă corect
- Navighează între pagini
- Verifică că a doua vizită este INSTANT
- Check DevTools pentru cache status

---

## 📞 Support

**Probleme?**

- Check React Query DevTools
- Check console pentru erori
- Verifică că hooks sunt importate corect
- Verifică că QueryClientProvider este în main.jsx

**TanStack Query este deja configurat și gata de folosit!**

Doar importă hooks-urile și folosește-le în componente! 🚀
