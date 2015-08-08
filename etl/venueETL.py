import MySQLdb as msq
from geopy import geocoders
from collections import OrderedDict
import json
from firebase import firebase

def getListOfAddresses(dbName, tblName):

    db = msq.connect("mysql.whatupsf.com", "kramamurthi", "dream2Win", dbName)
    cursor = db.cursor()
    sql = "SELECT address, city, state, zip FROM %s" %(tblName)
    print sql
    try:
        cursor.execute(sql)
        rows = cursor.fetchall()
        addressList = []
        for row in rows:
            address = row[0]
            city = row[1]
            state = row[2]
            zipcode = row[3]
            streetAddress = address + ', ' + city + ', ' + state + ' ' + repr(zipcode)
            addressList.append(streetAddress)

    except:
        print "Error: unable to execute query"
    else:
        return addressList
    finally:
        db.close()

def setLatLng(dbName, tblName):

    addressList = getListOfAddresses(dbName, tblName)
    googleEncoder = geocoders.GoogleV3()
    for address in addressList:
        place, (lat, lng) = googleEncoder.geocode(address)
        print "%s: %.5f, %.5f" % (place, lat, lng)


def get_json_data(dbName, tblName):

    db = msq.connect("mysql.whatupsf.com", "kramamurthi", "dream2Win", dbName)
    cursor = db.cursor()
    sql = "SELECT name, latitude, longitude, url FROM %s" %(tblName)
    print sql
    try:
        cursor.execute(sql)
        rows = cursor.fetchall()
        jsonList = []
        for row in rows:
            venue = row[0]
            lat = row[1]
            lng = row[2]
            url = row[3]
            curDict = {'venue': venue,
                       'lat': lat,
                       'lng': lng,
                       'url': url,
                       'events': [{'eventName': '',
                                   'eventTime': '',
                                   'eventPrice': '',
                                   'eventUrl': ''
                                   }]
                       }
            jsonList.append(curDict)

    except:
        print "Error: unable to execute query"
    else:
        return jsonList
    finally:
        db.close()


def dictfetchall(cursor):
    "Returns all rows from a cursor as a dict"
    desc = cursor.description
    return [OrderedDict(zip([col[0] for col in desc], row)) for row in cursor.fetchall()]

def get_table_json(dbName, tblName):

    db = msq.connect("mysql.whatupsf.com", "kramamurthi", "dream2Win", dbName)
    cursor = db.cursor()
    sql = "SELECT * from %s" %(tblName)
    try:
        cursor.execute(sql)
        jsonList = dictfetchall(cursor)
    except:
        print "Error: unable to execute query"
    else:
        return jsonList
    finally:
        db.close()

                                            
def dump_table_json(dbName, tblName):

    jData = get_table_json(dbName, tblName)
    jString = json.dumps(jData, sort_keys = False, indent=4)
    fH = open(tblName + ".json","w")
    fH.write(jString)
    fH.close()

def get_events(dump=False):

    eventList = []
    fire = firebase.FirebaseApplication('https://popping-fire-3129.firebaseio.com/')
    jData  = fire.get('', None)
    if dump:
        jString = json.dumps(jData, sort_keys = False, indent=4)
        fH = open("events.json","w")
        fH.write(jString)
        fH.close()
    for venue in jData:
        for event in venue[u'events']:
            if event[u'eventName'] != u'':
                eventList.append(event)

    return eventList, jData

def updated_venues(dump=False):
    E,D = get_events()
    V = get_json_data('sfev', 'venues')
    for venue in V:
        exists = False
        for location in D:
            if location['venue'] == venue['venue']:
                exists = True
        if not exists:
            D.append(venue)

    if dump:
        jString = json.dumps(D, sort_keys = False, indent=4)        
        fH = open("new_events.json","w")
        fH.write(jString)
        fH.close()

    return D


def ingest_bands(dbName, tblName):
    db = msq.connect("mysql.whatupsf.com", "kramamurthi", "dream2Win", dbName)
    cursor = db.cursor()
    events_data = get_events()  #Today's existing events

    # Get Unique Existing Bands in Table
    sql = "SELECT * from %s" %(tblName)
    print "Query: " + sql
    try:
        cursor.execute(sql)
        rows = cursor.fetchall()
        bandList = [] 
        for row in rows:
            bandList.append(row[1])
    except:
        print "Error: unable to execute read query"
    else:
        for event in events_data:
            if event[u'eventName'] not in bandList:
                sql = """INSERT into %s(name, media_url) VALUES("%s", "%s")""" %(tblName,event[u'eventName'], event[u'eventUrl'])
                print sql
                cursor.execute(sql)
    finally:
        db.close()
