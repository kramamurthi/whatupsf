import MySQLdb as msq
from geopy import geocoders

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



