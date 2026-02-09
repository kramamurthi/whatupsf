# WhatUpSF Database Architecture Analysis
**Original Design from ~2014** | **Analysis Date: February 2026**

---

## 🗄️ Database Schema Overview

### Database: `sfev` (San Francisco Events)
- **Host:** mysql.whatupsf.com
- **Engine:** MyISAM
- **Charset:** utf8mb3
- **Current Records:**
  - 60 Venues
  - 120 Bands/Artists
  - 116 Events

---

## 📊 Core Data Model

### Entity-Relationship Diagram

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│     VENUES      │         │      EVENTS      │         │      BANDS      │
├─────────────────┤         ├──────────────────┤         ├─────────────────┤
│ id (PK)         │◄────────│ venue_id (FK)    │─────────┤ id (PK)         │
│ name            │    1:N  │ band_id (FK)     │  N:1    │ name            │
│ address         │         │ event_date       │         │ media_url       │
│ latitude        │         │ event_time       │         │ image_url       │
│ longitude       │         │ event_price      │         │ descriptions    │
│ city            │         └──────────────────┘         └─────────────────┘
│ state           │
│ zipcode         │         Many-to-Many Relationship
│ phone           │         (Venues ↔ Bands via Events)
│ url             │
└─────────────────┘

      ▲
      │ Geocoded from
      │
┌─────────────────┐
│     GEOLOC      │
├─────────────────┤
│ address         │
│ city            │
│ statezip        │
│ latitude        │
│ longitude       │
└─────────────────┘
```

### DDL: Core Tables

#### 1. **venues** (Venue Master Data)
```sql
CREATE TABLE `venues` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,           -- Venue name (e.g., "The Fillmore")
  `address` varchar(255) NOT NULL,        -- Street address
  `latitude` double DEFAULT NULL,         -- Geocoded latitude
  `longitude` double DEFAULT NULL,        -- Geocoded longitude
  `city` varchar(30) NOT NULL,            -- City (e.g., "San Francisco")
  `state` varchar(2) NOT NULL,            -- State code (e.g., "CA")
  `zipcode` int DEFAULT NULL,             -- ZIP code
  `phone` varchar(12) NOT NULL,           -- Contact phone
  `url` varchar(50) NOT NULL,             -- Venue website
  PRIMARY KEY (`id`)
) ENGINE=MyISAM AUTO_INCREMENT=62 DEFAULT CHARSET=utf8mb3
```

**Purpose:** Master list of all venues in San Francisco
**Current Count:** 60 venues
**Key Fields:** lat/lng for map positioning, url for venue links

#### 2. **bands** (Artist/Band Master Data)
```sql
CREATE TABLE `bands` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,           -- Band/artist name
  `media_url` varchar(255) NOT NULL,      -- SoundCloud/YouTube URL
  `image_url` varchar(255) NOT NULL,      -- Band image/photo
  `descriptions` longtext NOT NULL,       -- Bio/description
  PRIMARY KEY (`id`)
) ENGINE=MyISAM AUTO_INCREMENT=123 DEFAULT CHARSET=utf8mb3
```

**Purpose:** Master list of bands/artists performing in SF
**Current Count:** 120 bands
**Key Fields:** media_url (for embedded players), image_url (for visual display)

#### 3. **events** (Event Junction Table)
```sql
CREATE TABLE `events` (
  `id` int NOT NULL AUTO_INCREMENT,
  `band_id` int NOT NULL,                 -- FK to bands.id
  `venue_id` int NOT NULL,                -- FK to venues.id
  `event_price` decimal(4,0) NOT NULL,    -- Ticket price ($)
  `event_date` date NOT NULL,             -- Event date (YYYY-MM-DD)
  `event_time` time NOT NULL,             -- Event time (HH:MM:SS)
  PRIMARY KEY (`id`),
  KEY `band_id_refs_id_e331afab` (`band_id`),
  KEY `venue_id_refs_id_f69f3952` (`venue_id`)
) ENGINE=MyISAM AUTO_INCREMENT=120 DEFAULT CHARSET=utf8mb3
```

**Purpose:** Junction table linking bands to venues with event details
**Current Count:** 116 events
**Relationship:** Many-to-Many (bands can play multiple venues, venues host multiple bands)
**Key Insight:** No explicit FOREIGN KEY constraints (MyISAM limitation), but indexes exist

#### 4. **geoloc** (Geocoding Cache)
```sql
CREATE TABLE `geoloc` (
  `address` varchar(50),
  `city` varchar(20),
  `statezip` varchar(20),
  `country` varchar(20),
  `latitude` float,
  `longitude` float
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb3
```

**Purpose:** Cache for geocoded addresses (to avoid repeated Google Maps API calls)
**Used By:** ETL process when adding new venues

---

## 🔄 Data Flow Architecture

### Original Intended Workflow (2014)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           DATA INPUT LAYER                               │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
           ┌────────────┐  ┌────────────┐  ┌────────────┐
           │   Django   │  │  Firebase  │  │   Manual   │
           │   Forms    │  │   Realtime │  │   MySQL    │
           │  (Web UI)  │  │    DB      │  │   Insert   │
           └────────────┘  └────────────┘  └────────────┘
                    │               │               │
                    ▼               ▼               ▼
           ┌─────────────────────────────────────────────┐
           │          MySQL Database (sfev)              │
           │   ┌──────────┐  ┌────────┐  ┌──────────┐  │
           │   │  venues  │  │ events │  │  bands   │  │
           │   └──────────┘  └────────┘  └──────────┘  │
           └─────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
           ┌────────────┐  ┌────────────┐  ┌────────────┐
           │    ETL     │  │   Django   │  │  Firebase  │
           │  Script    │  │   View     │  │   Export   │
           │(venueETL.py│  │   Query    │  │            │
           └────────────┘  └────────────┘  └────────────┘
                    │               │               │
                    └───────────────┼───────────────┘
                                    ▼
           ┌─────────────────────────────────────────────┐
           │         JSON API Endpoint                   │
           │     /api/map-data.json                      │
           └─────────────────────────────────────────────┘
                                    │
                                    ▼
           ┌─────────────────────────────────────────────┐
           │       Frontend Map Visualization            │
           │   (Leaflet.js + jQuery → Modern ES6)        │
           └─────────────────────────────────────────────┘
```

### Data Input Methods

#### 1. **Django Forms (Primary Method)**
**Routes:**
- `/event/` → EventInformationForm
- `/band/` → BandInformationForm
- `/venue/` → VenueInformationForm

**Forms (forms.py):**
```python
class EventInformationForm(forms.ModelForm):
    class Meta:
        model = Events
        fields = '__all__'  # band_id, venue_id, price, date, time

class BandInformationForm(forms.ModelForm):
    class Meta:
        model = Bands
        fields = '__all__'  # name, media_url, image_url, description

class VenueInformationForm(forms.ModelForm):
    class Meta:
        model = Venues
        fields = '__all__'  # name, address, lat, lng, city, state, etc.
```

**Workflow:**
1. User visits `/event/` form
2. Selects band (dropdown from bands table)
3. Selects venue (dropdown from venues table)
4. Enters date, time, price
5. Form saves to `events` table
6. Success page rendered

**Purpose:** Allow community/admin to add events through web UI

#### 2. **Firebase Realtime Database (Hybrid Approach)**
**Evidence in venueETL.py:**
```python
def get_events(dump=False):
    fire = firebase.FirebaseApplication('https://popping-fire-3129.firebaseio.com/')
    jData = fire.get('', None)
    # Retrieves events from Firebase
```

**Purpose:**
- Real-time collaborative event editing
- Mobile app integration
- Quick updates without MySQL access
- Firebase → MySQL sync via ETL

#### 3. **Direct MySQL Insertion**
**Evidence:** ETL script `ingest_bands()` function
```python
def ingest_bands(dbName, tblName):
    # Reads from Firebase
    # Inserts unique bands into MySQL bands table
    sql = """INSERT into %s(name, media_url) VALUES("%s", "%s")"""
```

**Purpose:** Batch import/sync from Firebase to MySQL

---

## 🔧 ETL Process (venueETL.py)

### Key Functions

#### 1. **get_latest_info(dbName)** - Main Query Logic
```sql
SELECT V.name, V.latitude, V.longitude, V.url,
       E.event_price, E.event_date, E.event_time,
       B.name, B.media_url
FROM venues V
LEFT JOIN events E ON V.id = E.venue_id
LEFT JOIN bands B ON B.id = E.band_id
WHERE (STR_TO_DATE(CONCAT(event_date, ' ', event_time), '%Y-%m-%d %H:%i:%s')
      = (SELECT max(STR_TO_DATE(CONCAT(event_date, ' ', event_time), '%Y-%m-%d %H:%i:%s'))
         FROM events E2 WHERE E.venue_id=E2.venue_id))
   OR E.event_date is NULL
```

**Purpose:** Get the **latest/next event** for each venue

**Output Format:**
```json
[
  {
    "venue": "The Fillmore",
    "lat": 37.7836,
    "lng": -122.4331,
    "url": "thefillmore.com",
    "events": [
      {
        "eventName": "Radiohead",
        "eventTime": "08:00 PM",
        "eventPrice": "45$",
        "eventUrl": "soundcloud.com/track/123456"
      }
    ]
  }
]
```

#### 2. **updated_venues(dump=False)** - Hybrid Sync
```python
def updated_venues(dump=False):
    E, D = get_events()          # Get events from Firebase
    V = get_json_data('sfev', 'venues')  # Get venues from MySQL

    # Merge: Add MySQL venues not in Firebase
    for venue in V:
        exists = False
        for location in D:
            if location['venue'] == venue['venue']:
                exists = True
        if not exists:
            D.append(venue)

    # Output to new_events.json
```

**Purpose:** Combine Firebase events + MySQL venues into single JSON

#### 3. **Geocoding Functions**
```python
def setLatLng(dbName, tblName):
    addressList = getListOfAddresses(dbName, tblName)
    googleEncoder = geocoders.GoogleV3()
    for address in addressList:
        place, (lat, lng) = googleEncoder.geocode(address)
```

**Purpose:** Geocode venue addresses to lat/lng for map display

---

## 🎯 Intended System Behavior

### How It Was Supposed to Work

#### **Phase 1: Data Collection**
1. **Venue Onboarding:**
   - Admin adds venue via `/venue/` form
   - System geocodes address → lat/lng
   - Stores in `venues` table

2. **Band/Artist Registration:**
   - Add band via `/band/` form
   - Include SoundCloud URL for music preview
   - Store in `bands` table

3. **Event Scheduling:**
   - Add event via `/event/` form
   - Select band (dropdown)
   - Select venue (dropdown)
   - Set date, time, price
   - Store in `events` table (junction)

#### **Phase 2: Data Processing**
1. **ETL Script Execution:**
   ```bash
   python venueETL.py
   ```
   - Queries MySQL for latest events
   - Syncs with Firebase data
   - Generates JSON output

2. **JSON Generation:**
   - `publish.json` → Latest event per venue
   - `new_events.json` → All venues + Firebase events
   - `venues.json` → All venues (no events)

#### **Phase 3: API Serving**
**Current (Static):**
```python
def render_json(request):
    with open('/static/new_events.json', 'r') as f:
        json_data = json.load(f)
    return HttpResponse(json.dumps(json_data), content_type="application/json")
```

**Intended (Dynamic):**
```python
def render_json(request):
    from whatupsf.models import Venues, Events, Bands

    venues = Venues.objects.all()
    data = []
    for venue in venues:
        events = Events.objects.filter(venue_id=venue.id,
                                      event_date__gte=datetime.now())
        venue_data = {
            'venue': venue.name,
            'lat': venue.latitude,
            'lng': venue.longitude,
            'url': venue.url,
            'events': [
                {
                    'eventName': e.band_id.name,
                    'eventTime': e.event_time.strftime('%I:%M %p'),
                    'eventPrice': f'${e.event_price}',
                    'eventUrl': e.band_id.media_url
                } for e in events
            ]
        }
        data.append(venue_data)
    return JsonResponse(data, safe=False)
```

#### **Phase 4: Visualization**
- Frontend fetches `/api/map-data.json`
- Clusters markers at low zoom (via clustering algorithm)
- Displays individual markers at high zoom
- Shows popups with:
  - Venue name + link
  - Embedded SoundCloud player
  - Event details (band, time, price)

---

## 🚨 Issues with Current Implementation

### 1. **Static JSON instead of Dynamic Queries**
**Problem:** Currently loading from static `new_events.json`
**Impact:**
- Data gets stale
- Manual ETL execution required
- No real-time updates
- Events don't auto-expire

### 2. **Missing Foreign Key Constraints**
**Problem:** MyISAM engine doesn't enforce FK relationships
**Impact:**
- Can have orphaned events (band_id/venue_id don't exist)
- No referential integrity
- Data inconsistencies possible

### 3. **Deprecated Technologies**
- **Firebase SDK:** Old 2013-era library
- **MyISAM:** Should use InnoDB for ACID compliance
- **Python 2:** Code written for Python 2.x
- **bootstrap3_datetime:** Deprecated library

### 4. **No Event Expiration Logic**
**Problem:** No cleanup of past events
**Impact:**
- Database grows indefinitely
- Old events still show on map
- Need manual pruning

### 5. **Security Issues**
- Database credentials hardcoded
- No SQL injection protection in ETL script (string formatting)
- No CSRF protection evident in forms

---

## ✅ Recommended Modernization

### **Phase 1: Database Migration**
```sql
-- Convert to InnoDB with proper FKs
ALTER TABLE venues ENGINE=InnoDB;
ALTER TABLE bands ENGINE=InnoDB;
ALTER TABLE events ENGINE=InnoDB;

-- Add foreign key constraints
ALTER TABLE events
  ADD CONSTRAINT fk_events_band
  FOREIGN KEY (band_id) REFERENCES bands(id) ON DELETE CASCADE;

ALTER TABLE events
  ADD CONSTRAINT fk_events_venue
  FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE;

-- Add indexes for performance
CREATE INDEX idx_event_date ON events(event_date, event_time);
CREATE INDEX idx_venue_location ON venues(latitude, longitude);

-- Add soft delete for expired events
ALTER TABLE events ADD COLUMN is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE events ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE events ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
```

### **Phase 2: Replace Static JSON with Dynamic API**
```python
# whatupsf/views/api_views.py
from django.http import JsonResponse
from django.db.models import Q, Prefetch
from datetime import datetime, timedelta
from whatupsf.models import Venues, Events, Bands

def map_data_api(request):
    """
    Dynamic API endpoint for map data
    Returns venues with upcoming events
    """
    # Get filter parameters
    date_from = request.GET.get('date_from', datetime.now())
    date_to = request.GET.get('date_to', datetime.now() + timedelta(days=30))
    price_max = request.GET.get('price_max', 1000)

    # Query with prefetch for performance
    venues = Venues.objects.prefetch_related(
        Prefetch(
            'events_set',
            queryset=Events.objects.filter(
                event_date__range=[date_from, date_to],
                event_price__lte=price_max,
                is_active=True
            ).select_related('band')
        )
    ).all()

    # Build response
    data = []
    for venue in venues:
        events_list = []
        for event in venue.events_set.all():
            events_list.append({
                'eventName': event.band.name,
                'eventTime': event.event_time.strftime('%I:%M %p'),
                'eventPrice': f'${event.event_price}',
                'eventUrl': event.band.media_url,
                'eventDate': event.event_date.isoformat()
            })

        if events_list or request.GET.get('show_all', False):
            data.append({
                'venue': venue.name,
                'lat': venue.latitude,
                'lng': venue.longitude,
                'url': venue.url,
                'events': events_list
            })

    return JsonResponse(data, safe=False)
```

### **Phase 3: Add Django REST Framework**
```python
# Install: pip install djangorestframework

# Serializers
from rest_framework import serializers

class BandSerializer(serializers.ModelSerializer):
    class Meta:
        model = Bands
        fields = ['id', 'name', 'media_url', 'image_url']

class EventSerializer(serializers.ModelSerializer):
    band = BandSerializer(source='band_id', read_only=True)

    class Meta:
        model = Events
        fields = ['id', 'band', 'event_price', 'event_date', 'event_time']

class VenueSerializer(serializers.ModelSerializer):
    upcoming_events = serializers.SerializerMethodField()

    def get_upcoming_events(self, obj):
        events = Events.objects.filter(
            venue_id=obj,
            event_date__gte=datetime.now(),
            is_active=True
        ).select_related('band_id')[:5]
        return EventSerializer(events, many=True).data

    class Meta:
        model = Venues
        fields = ['id', 'name', 'latitude', 'longitude', 'url',
                  'city', 'state', 'upcoming_events']
```

### **Phase 4: Background Tasks for ETL**
```python
# Use Celery for scheduled tasks
from celery import shared_task
from datetime import datetime

@shared_task
def expire_past_events():
    """Mark past events as inactive"""
    Events.objects.filter(
        event_date__lt=datetime.now(),
        is_active=True
    ).update(is_active=False)

@shared_task
def sync_firebase_events():
    """Sync events from Firebase (if still in use)"""
    # Import from Firebase
    # Update MySQL
    pass

# In celerybeat_schedule (settings.py):
CELERY_BEAT_SCHEDULE = {
    'expire-past-events': {
        'task': 'whatupsf.tasks.expire_past_events',
        'schedule': crontab(hour=0, minute=0),  # Daily at midnight
    },
}
```

---

## 📈 Performance Optimizations

### 1. **Database Indexes**
```sql
CREATE INDEX idx_events_venue_date ON events(venue_id, event_date);
CREATE INDEX idx_events_band_date ON events(band_id, event_date);
CREATE INDEX idx_events_active ON events(is_active, event_date);
```

### 2. **Query Optimization**
- Use `select_related()` for FK lookups
- Use `prefetch_related()` for reverse FKs
- Add database caching (Redis)
- Consider materialized view for map data

### 3. **API Caching**
```python
from django.views.decorators.cache import cache_page

@cache_page(60 * 15)  # Cache for 15 minutes
def map_data_api(request):
    # ... API logic
```

---

## 🎯 Summary

### **Original Architecture (2014)**
✅ **Good Design:**
- Clean relational model (venues → events ← bands)
- Hybrid approach (MySQL + Firebase)
- ETL pipeline for data processing
- Geocoding integration
- User-friendly forms for data input

❌ **Limitations:**
- Static JSON serving (no dynamic queries)
- MyISAM (no FK constraints)
- Manual ETL execution
- Deprecated technologies
- No event expiration logic

### **Current State (2026)**
- Database still active with 60 venues, 120 bands, 116 events
- Using static JSON file from 2015 (stale data)
- Frontend modernized (jQuery → ES6)
- Backend still using legacy approach

### **Recommended Next Steps**
1. ✅ **Immediate:** Switch to dynamic API (already analyzed)
2. 🔄 **Short-term:** Migrate to InnoDB + add FK constraints
3. 🚀 **Medium-term:** Implement Django REST Framework API
4. 🎯 **Long-term:** Add Celery tasks, caching, real-time updates

---

**The original vision was sound** - a community-driven event discovery platform with real-time data. The architecture just needs modernization to leverage 2026 best practices while preserving the elegant relational design you created 10 years ago.
