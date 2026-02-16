import MySQLdb as msq  # Note: For Python 3, install 'mysqlclient' package
from geopy import geocoders
from collections import OrderedDict
import json
from firebase import firebase
import datetime
from time import strftime
import sys

def getListOfAddresses(dbName, tblName):

    db = msq.connect("mysql.whatupsf.com", "kramamurthi", "dream2Win", dbName)
    cursor = db.cursor()
    sql = "SELECT address, city, state, zip FROM %s" %(tblName)
    print(sql)
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
        print("Error: unable to execute query")
    else:
        return addressList
    finally:
        db.close()

def setLatLng(dbName, tblName):

    addressList = getListOfAddresses(dbName, tblName)
    googleEncoder = geocoders.GoogleV3()
    for address in addressList:
        place, (lat, lng) = googleEncoder.geocode(address)
        print("%s: %.5f, %.5f" % (place, lat, lng))

def get_latest_info(dbName):

    db = msq.connect("mysql.whatupsf.com", "kramamurthi", "dream2Win", dbName)
    cursor = db.cursor()
    sql = """SELECT V.name, V.latitude, V.longitude, V.url,
                    E.event_price, E.event_date, E.event_time,
                    B.name, B.media_url
                    FROM venues V 
                    LEFT JOIN events E ON V.id = E.venue_id 
                    LEFT JOIN bands B on B.id = E.band_id 
             WHERE (STR_TO_DATE(CONCAT(event_date, ' ', event_time), '%Y-%m-%d %H:%i:%s')
                   = (SELECT max(STR_TO_DATE(CONCAT(event_date, ' ', event_time), '%Y-%m-%d %H:%i:%s'))
             FROM events E2 WHERE E.venue_id=E2.venue_id)) OR E.event_date is NULL
          """
    try:
        cursor.execute(sql)
        rows = cursor.fetchall()
        jsonList = []
        for row in rows:
            venue = row[0]
            lat = row[1]
            lng = row[2]
            url = row[3]

            if row[4]:
                eventPrice = str(row[4])+'$'
            else:
                eventPrice = ''

            if row[6]:
                fmt =  '%I:%M %p'
                print(row[6], type(row[6]))
                eventTime = (datetime.datetime.min + row[6]).time() # row[6] is of time datetime.timedelta
                eventTime = eventTime.strftime(fmt)
            else:
                eventTime = ''

            if row[7]:
                eventName = row[7]
            else:
                eventName = ''

            if row[8]:    
                eventUrl = row[8]
            else:
                eventUrl = ''

            curDict = {'venue': venue,
                       'lat': lat,
                       'lng': lng,
                       'url': url,
                       'events': [{'eventName': eventName,
                                   'eventTime': eventTime,
                                   'eventPrice': eventPrice,
                                   'eventUrl': eventUrl
                                   }]
                       }
            jsonList.append(curDict)

    except:
        print("Error: unable to execute query or process it: ", sys.exc_info()[0])
    else:
        return jsonList
    finally:
        db.close()


def get_json_data(dbName, tblName):

    db = msq.connect("mysql.whatupsf.com", "kramamurthi", "dream2Win", dbName)
    cursor = db.cursor()
    sql = "SELECT name, latitude, longitude, url FROM %s" %(tblName)
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
        print("Error: unable to execute query")
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
        print("Error: unable to execute query")
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


def dump_latest_info(dbName):

    jData = get_latest_info(dbName)
    jString = json.dumps(jData, sort_keys = False, indent=4)
    fH = open("publish.json", "w")
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
    print("Query: " + sql)
    try:
        cursor.execute(sql)
        rows = cursor.fetchall()
        bandList = []
        for row in rows:
            bandList.append(row[1])
    except:
        print("Error: unable to execute read query")
    else:
        for event in events_data:
            if event['eventName'] not in bandList:
                sql = """INSERT into %s(name, media_url) VALUES("%s", "%s")""" %(tblName, event['eventName'], event['eventUrl'])
                print(sql)
                cursor.execute(sql)
    finally:
        db.close()
