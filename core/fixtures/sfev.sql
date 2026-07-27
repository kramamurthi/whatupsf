-- MySQL dump 10.13  Distrib 5.5.38, for debian-linux-gnu (x86_64)
--
-- Host: mysql.whatupsf.com    Database: sfev
-- ------------------------------------------------------
-- Server version	5.1.56-log

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `auth_group`
--

DROP TABLE IF EXISTS `auth_group`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `auth_group` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(80) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=MyISAM AUTO_INCREMENT=3 DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `auth_group`
--

LOCK TABLES `auth_group` WRITE;
/*!40000 ALTER TABLE `auth_group` DISABLE KEYS */;
INSERT INTO `auth_group` VALUES (1,'UberUser'),(2,'MinorUser');
/*!40000 ALTER TABLE `auth_group` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `auth_group_permissions`
--

DROP TABLE IF EXISTS `auth_group_permissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `auth_group_permissions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `group_id` int(11) NOT NULL,
  `permission_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `group_id` (`group_id`,`permission_id`),
  KEY `auth_group_permissions_5f412f9a` (`group_id`),
  KEY `auth_group_permissions_83d7f98b` (`permission_id`)
) ENGINE=MyISAM AUTO_INCREMENT=34 DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `auth_group_permissions`
--

LOCK TABLES `auth_group_permissions` WRITE;
/*!40000 ALTER TABLE `auth_group_permissions` DISABLE KEYS */;
INSERT INTO `auth_group_permissions` VALUES (24,1,18),(23,1,17),(22,1,16),(21,1,15),(20,1,14),(19,1,13),(18,1,12),(17,1,11),(16,1,10),(15,1,6),(14,1,5),(13,1,4),(25,2,10),(26,2,11),(27,2,12),(28,2,13),(29,2,14),(30,2,15),(31,2,16),(32,2,17),(33,2,18);
/*!40000 ALTER TABLE `auth_group_permissions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `auth_message`
--

DROP TABLE IF EXISTS `auth_message`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `auth_message` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `message` longtext NOT NULL,
  PRIMARY KEY (`id`),
  KEY `auth_message_fbfc09f1` (`user_id`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `auth_message`
--

LOCK TABLES `auth_message` WRITE;
/*!40000 ALTER TABLE `auth_message` DISABLE KEYS */;
/*!40000 ALTER TABLE `auth_message` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `auth_permission`
--

DROP TABLE IF EXISTS `auth_permission`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `auth_permission` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL,
  `content_type_id` int(11) NOT NULL,
  `codename` varchar(100) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `content_type_id` (`content_type_id`,`codename`),
  KEY `auth_permission_37ef4eb4` (`content_type_id`)
) ENGINE=MyISAM AUTO_INCREMENT=25 DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `auth_permission`
--

LOCK TABLES `auth_permission` WRITE;
/*!40000 ALTER TABLE `auth_permission` DISABLE KEYS */;
INSERT INTO `auth_permission` VALUES (1,'Can add log entry',1,'add_logentry'),(2,'Can change log entry',1,'change_logentry'),(3,'Can delete log entry',1,'delete_logentry'),(4,'Can add permission',2,'add_permission'),(5,'Can change permission',2,'change_permission'),(6,'Can delete permission',2,'delete_permission'),(7,'Can add group',3,'add_group'),(8,'Can change group',3,'change_group'),(9,'Can delete group',3,'delete_group'),(10,'Can add user',4,'add_user'),(11,'Can change user',4,'change_user'),(12,'Can delete user',4,'delete_user'),(13,'Can add content type',5,'add_contenttype'),(14,'Can change content type',5,'change_contenttype'),(15,'Can delete content type',5,'delete_contenttype'),(16,'Can add session',6,'add_session'),(17,'Can change session',6,'change_session'),(18,'Can delete session',6,'delete_session'),(23,'Can change event information',8,'change_eventinformation'),(22,'Can add event information',8,'add_eventinformation'),(24,'Can delete event information',8,'delete_eventinformation');
/*!40000 ALTER TABLE `auth_permission` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `auth_user`
--

DROP TABLE IF EXISTS `auth_user`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `auth_user` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `password` varchar(128) NOT NULL,
  `last_login` datetime NOT NULL,
  `is_superuser` tinyint(1) NOT NULL,
  `username` varchar(30) NOT NULL,
  `first_name` varchar(30) NOT NULL,
  `last_name` varchar(30) NOT NULL,
  `email` varchar(75) NOT NULL,
  `is_staff` tinyint(1) NOT NULL,
  `is_active` tinyint(1) NOT NULL,
  `date_joined` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`)
) ENGINE=MyISAM AUTO_INCREMENT=3 DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `auth_user`
--

LOCK TABLES `auth_user` WRITE;
/*!40000 ALTER TABLE `auth_user` DISABLE KEYS */;
INSERT INTO `auth_user` VALUES (1,'pbkdf2_sha256$12000$NNBKIisbPiZ8$8Td9dg5U/TcSLT39Qsv1Voef5hrxHQDc2c6sH6Pf54A=','2014-03-28 05:15:14',1,'kriram5','Alex','Pandian','alexpandian@me.com',1,1,'2014-03-28 05:12:56'),(2,'pbkdf2_sha256$12000$BbaGQQtBQdwR$fClEzkE4e1VjU/hkgWTc/iGM21uOnSefhhWyT/WcPmQ=','2014-03-28 05:22:35',0,'kramamurthi','Krishna','Ramamurthi','krishna.ramamurthi@gmail.com',1,1,'2014-03-28 05:18:27');
/*!40000 ALTER TABLE `auth_user` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `auth_user_groups`
--

DROP TABLE IF EXISTS `auth_user_groups`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `auth_user_groups` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `group_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_id` (`user_id`,`group_id`),
  KEY `auth_user_groups_6340c63c` (`user_id`),
  KEY `auth_user_groups_5f412f9a` (`group_id`)
) ENGINE=MyISAM AUTO_INCREMENT=2 DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `auth_user_groups`
--

LOCK TABLES `auth_user_groups` WRITE;
/*!40000 ALTER TABLE `auth_user_groups` DISABLE KEYS */;
INSERT INTO `auth_user_groups` VALUES (1,2,1);
/*!40000 ALTER TABLE `auth_user_groups` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `auth_user_user_permissions`
--

DROP TABLE IF EXISTS `auth_user_user_permissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `auth_user_user_permissions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `permission_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_id` (`user_id`,`permission_id`),
  KEY `auth_user_user_permissions_6340c63c` (`user_id`),
  KEY `auth_user_user_permissions_83d7f98b` (`permission_id`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `auth_user_user_permissions`
--

LOCK TABLES `auth_user_user_permissions` WRITE;
/*!40000 ALTER TABLE `auth_user_user_permissions` DISABLE KEYS */;
/*!40000 ALTER TABLE `auth_user_user_permissions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `bands`
--

DROP TABLE IF EXISTS `bands`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `bands` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) DEFAULT NULL,
  `media_url` text,
  `image_url` text,
  `descriptions` text,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM AUTO_INCREMENT=18 DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `bands`
--

LOCK TABLES `bands` WRITE;
/*!40000 ALTER TABLE `bands` DISABLE KEYS */;
INSERT INTO `bands` VALUES (1,'Bombshell Betty','http://www.youtube.com/embed/dRc3tYZJ5eI',NULL,NULL),(2,'Snowapple','https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/141412298',NULL,NULL),(3,'Hella Tight','http://player.vimeo.com/video/16101483',NULL,NULL),(4,'DWELE','http://www.youtube.com/embed/nXeXT6FGEls',NULL,NULL),(5,'Robert Walter\'s 20th Congress','http://www.youtube.com/embed/RDaQ0k7UkIE',NULL,NULL),(6,'DJ K-OS','http://www.youtube.com/embed/vbBxTH15fSM',NULL,NULL),(7,'Ben Fields','https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/152786473',NULL,NULL),(8,'Wakey!Wakey!','http://www.youtube.com/embed/okAQ-aRTBAY',NULL,NULL),(9,'Terminator Too','http://www.youtube.com/embed/hEoMJkN1l7k',NULL,NULL),(10,'Point Break Live','http://www.youtube.com/embed/PEOsR0fj4dw',NULL,NULL),(11,'Shiny Objects','http://www.youtube.com/embed/0K4nFVfZWp0',NULL,NULL),(12,'Rob Garza','https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/108765030',NULL,NULL),(13,'Justin Martin','https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/139072942',NULL,NULL),(14,'The Thurston Moore Band','http://www.youtube.com/embed/JrueCma8IgE',NULL,NULL),(15,'Sebadoh','http://www.youtube.com/embed/UBWWL0nh9kI',NULL,NULL),(16,'Nice7','http://www.youtube.com/embed/vSFJEKLPBUs',NULL,NULL),(17,'DJ c-lektra','https://w.soundcloud.com/player/?url=https://api.soundcloud.com/tracks/93470472',NULL,NULL);
/*!40000 ALTER TABLE `bands` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `django_admin_log`
--

DROP TABLE IF EXISTS `django_admin_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `django_admin_log` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `action_time` datetime NOT NULL,
  `user_id` int(11) NOT NULL,
  `content_type_id` int(11) DEFAULT NULL,
  `object_id` longtext,
  `object_repr` varchar(200) NOT NULL,
  `action_flag` smallint(5) unsigned NOT NULL,
  `change_message` longtext NOT NULL,
  PRIMARY KEY (`id`),
  KEY `django_admin_log_6340c63c` (`user_id`),
  KEY `django_admin_log_37ef4eb4` (`content_type_id`)
) ENGINE=MyISAM AUTO_INCREMENT=6 DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `django_admin_log`
--

LOCK TABLES `django_admin_log` WRITE;
/*!40000 ALTER TABLE `django_admin_log` DISABLE KEYS */;
INSERT INTO `django_admin_log` VALUES (1,'2014-03-28 05:16:42',1,3,'1','UberUser',1,''),(2,'2014-03-28 05:16:45',1,3,'1','UberUser',2,'No fields changed.'),(3,'2014-03-28 05:17:26',1,3,'2','MinorUser',1,''),(4,'2014-03-28 05:18:28',1,4,'2','kramamurthi',1,''),(5,'2014-03-28 05:19:08',1,4,'2','kramamurthi',2,'Changed first_name, last_name, email, is_staff and groups.');
/*!40000 ALTER TABLE `django_admin_log` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `django_content_type`
--

DROP TABLE IF EXISTS `django_content_type`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `django_content_type` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `app_label` varchar(100) NOT NULL,
  `model` varchar(100) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `app_label` (`app_label`,`model`)
) ENGINE=MyISAM AUTO_INCREMENT=9 DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `django_content_type`
--

LOCK TABLES `django_content_type` WRITE;
/*!40000 ALTER TABLE `django_content_type` DISABLE KEYS */;
INSERT INTO `django_content_type` VALUES (1,'log entry','admin','logentry'),(2,'permission','auth','permission'),(3,'group','auth','group'),(4,'user','auth','user'),(5,'content type','contenttypes','contenttype'),(6,'session','sessions','session'),(8,'event information','whatupsf','eventinformation');
/*!40000 ALTER TABLE `django_content_type` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `django_migrations`
--

DROP TABLE IF EXISTS `django_migrations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `django_migrations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `app` varchar(255) NOT NULL,
  `name` varchar(255) NOT NULL,
  `applied` datetime NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM AUTO_INCREMENT=6 DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `django_migrations`
--

LOCK TABLES `django_migrations` WRITE;
/*!40000 ALTER TABLE `django_migrations` DISABLE KEYS */;
INSERT INTO `django_migrations` VALUES (1,'contenttypes','0001_initial','2014-10-07 22:02:40'),(2,'auth','0001_initial','2014-10-07 22:02:40'),(3,'admin','0001_initial','2014-10-07 22:02:40'),(4,'sessions','0001_initial','2014-10-07 22:02:40'),(5,'whatupsf','0001_initial','2014-10-08 06:22:48');
/*!40000 ALTER TABLE `django_migrations` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `django_session`
--

DROP TABLE IF EXISTS `django_session`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `django_session` (
  `session_key` varchar(40) NOT NULL,
  `session_data` longtext NOT NULL,
  `expire_date` datetime NOT NULL,
  PRIMARY KEY (`session_key`),
  KEY `django_session_b7b81f0c` (`expire_date`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `django_session`
--

LOCK TABLES `django_session` WRITE;
/*!40000 ALTER TABLE `django_session` DISABLE KEYS */;
INSERT INTO `django_session` VALUES ('ve3ode14zqe3hbiwhs59b3f4upomkmih','YTNmYWNjNzQxYTliMWIzNmYzYjA3Mjk3YjczMDBkOGM1YTQ1MDg2MDp7Il9hdXRoX3VzZXJfYmFja2VuZCI6ImRqYW5nby5jb250cmliLmF1dGguYmFja2VuZHMuTW9kZWxCYWNrZW5kIiwiX2F1dGhfdXNlcl9pZCI6Mn0=','2014-04-11 05:22:35');
/*!40000 ALTER TABLE `django_session` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `geoloc`
--

DROP TABLE IF EXISTS `geoloc`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `geoloc` (
  `address` varchar(50) DEFAULT NULL,
  `city` varchar(20) DEFAULT NULL,
  `statezip` varchar(20) DEFAULT NULL,
  `country` varchar(20) DEFAULT NULL,
  `latitude` float DEFAULT NULL,
  `longitude` float DEFAULT NULL,
  `id` int(11) NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM AUTO_INCREMENT=49 DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `geoloc`
--

LOCK TABLES `geoloc` WRITE;
/*!40000 ALTER TABLE `geoloc` DISABLE KEYS */;
INSERT INTO `geoloc` VALUES ('333 11th Street',' San Francisco',' CA 94103',' USA',37.7715,-122.413,1),('859 O\'Farrell Street',' San Francisco',' CA 94109',' USA',37.7848,-122.419,2),('500 4th Street',' San Francisco',' CA 94107',' USA',37.7793,-122.398,3),('853 Valencia Street',' San Francisco',' CA 94110',' USA',37.7593,-122.421,4),('3248 22nd Street',' San Francisco',' CA 94110',' USA',37.7555,-122.42,5),('2170 Market Street',' San Francisco',' CA 94114',' USA',37.7668,-122.43,6),('1330 Fillmore Street',' San Francisco',' CA 94115',' USA',37.7821,-122.432,7),('1601 Fillmore Street',' San Francisco',' CA 94115',' USA',37.7846,-122.433,8),('777 Valencia Street',' San Francisco',' CA 94110',' USA',37.7606,-122.421,9),('2183 Mission Street',' San Francisco',' CA 94110',' USA',37.7621,-122.419,10),('1710 Mission Street',' San Francisco',' CA 94103',' USA',37.7697,-122.42,11),('161 Erie Street',' San Francisco',' CA 94103',' USA',37.7689,-122.419,12),('1539 Folsom Street',' San Francisco',' CA 94103',' USA',37.7713,-122.414,13),('1535 Folsom Street',' San Francisco',' CA 94103',' USA',37.7714,-122.414,14),('314 11th Street',' San Francisco',' CA 94103',' USA',37.7715,-122.414,15),('354 11th Street',' San Francisco',' CA 94103',' USA',37.771,-122.413,16),('375 11th Street',' San Francisco',' CA 94103',' USA',37.771,-122.413,17),('2389 Mission Street',' San Francisco',' CA 94110',' USA',37.7589,-122.419,18),('2937 Mission Street',' San Francisco',' CA 94110',' USA',37.75,-122.418,19),('3158 Mission Street',' San Francisco',' CA 94110',' USA',37.7468,-122.419,20),('540 Valencia Street',' San Francisco',' CA 94110',' USA',37.7643,-122.422,21),('1015 Folsom Street',' San Francisco',' CA 94103',' USA',37.7781,-122.406,22),('1190 Folsom Street',' San Francisco',' CA 94103',' USA',37.7754,-122.41,23),('1192 Folsom Street',' San Francisco',' CA 94103',' USA',37.7753,-122.41,24),('1015 Folsom Street',' San Francisco',' CA 94103',' USA',37.7781,-122.406,25),('401 6th Street',' San Francisco',' CA 94708',' USA',37.7772,-122.404,26),('420 Mason Street',' San Francisco',' CA 94102',' USA',37.7876,-122.41,27),('1151 Folsom Street',' San Francisco',' CA 94103',' USA',37.7758,-122.409,28),('1111 California Street',' San Francisco',' CA 94108',' USA',37.7912,-122.413,29),('628 Divisadero Street',' San Francisco',' CA 94117',' USA',37.7755,-122.438,30),('201 Franklin Street',' San Francisco',' CA 94102',' USA',37.7763,-122.422,31),('1192 Market Street',' San Francisco',' CA 94102',' USA',37.7793,-122.415,32),('982 Market Street',' San Francisco',' CA 94102',' USA',37.7827,-122.41,33),('101 6th Street',' San Francisco',' CA 94103',' USA',37.781,-122.408,34),('119 Utah Street',' San Francisco',' CA 94103',' USA',37.7675,-122.407,35),('1600 17th Street',' San Francisco',' CA 94107',' USA',37.7651,-122.4,36),('1233 17th Street',' San Francisco',' CA 94107',' USA',37.765,-122.396,37),('2424 Mariposa Street',' San Francisco',' CA 94110',' USA',37.7634,-122.408,38),('1131 Polk Street',' San Francisco',' CA 94109',' USA',37.7874,-122.42,39),('155 Fell Street',' San Francisco',' CA 94102',' USA',37.7761,-122.42,40),('401 Mason Street',' San Francisco',' CA 94102',' USA',37.7873,-122.41,41),('444 Jessie Street',' San Francisco',' CA 94103',' USA',37.7825,-122.408,42),('800 Post Street',' San Francisco',' CA 94109',' USA',37.7876,-122.415,43),('561 Geary Street',' San Francisco',' CA 94102',' USA',37.7868,-122.413,44),('1695 Polk Street',' San Francisco',' CA 94109',' USA',37.7922,-122.421,45),('2299 Mission Street',' San Francisco',' CA 94110',' USA',37.7603,-122.419,46),('3376 19th Street',' San Francisco',' CA 94110',' USA',37.7603,-122.419,47),('806 South Van Ness Avenue',' San Francisco',' CA 94110',' USA',37.7602,-122.417,48);
/*!40000 ALTER TABLE `geoloc` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `venues`
--

DROP TABLE IF EXISTS `venues`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `venues` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) DEFAULT NULL,
  `address` varchar(255) DEFAULT NULL,
  `latitude` float DEFAULT NULL,
  `longitude` float DEFAULT NULL,
  `city` varchar(30) DEFAULT NULL,
  `state` varchar(2) DEFAULT NULL,
  `zip` mediumint(5) unsigned zerofill DEFAULT NULL,
  `phone` varchar(12) DEFAULT NULL,
  `url` varchar(50) DEFAULT NULL,
  `info` text,
  `image_url` text,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM AUTO_INCREMENT=49 DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `venues`
--

LOCK TABLES `venues` WRITE;
/*!40000 ALTER TABLE `venues` DISABLE KEYS */;
INSERT INTO `venues` VALUES (1,'Slim\'s','333 11th Street',37.7715,-122.413,'San Francisco','CA',94103,'415-255-0333','slimspresents.com',NULL,NULL),(2,'Great American Music Hall','859 O\'Farrell Street',37.7848,-122.419,'San Francisco','CA',94109,'415-885-0750','gamh.com',NULL,NULL),(3,'The Hotel Utah Saloon','500 4th Street',37.7793,-122.398,'San Francisco','CA',94107,'415-546-6300','hotelutah.com',NULL,NULL),(4,'Amnesia','853 Valencia Street',37.7593,-122.421,'San Francisco','CA',94110,'415-970-0012','amnesiathebar.com',NULL,NULL),(5,'Revolution Cafe','3248 22nd Street',37.7555,-122.42,'San Francisco','CA',94110,'415-642-0474','revolutioncafesf.com',NULL,NULL),(6,'Cafe Du Nord','2170 Market Street',37.7668,-122.43,'San Francisco','CA',94114,'415-861-5016','cafedunord.com',NULL,NULL),(7,'Yoshi\'s SF','1330 Fillmore Street',37.7821,-122.432,'San Francisco','CA',94115,'415-655-5600','yoshis.com/sanfrancisco',NULL,NULL),(8,'Boom Boom Room','1601 Fillmore Street',37.7846,-122.433,'San Francisco','CA',94115,'415-673-8000','boomboomblues.com',NULL,NULL),(9,'The Chapel','777 Valencia Street',37.7606,-122.421,'San Francisco','CA',94110,'415-551-5157','thechapelsf.com',NULL,NULL),(10,'Sub-Mission','2183 Mission Street',37.7621,-122.419,'San Francisco','CA',94110,'415-255-7227','sf-submission.com',NULL,NULL),(11,'Brick & Mortar Music Hall','1710 Mission Street',37.7697,-122.42,'San Francisco','CA',94103,'415-800-8782','brickandmortarmusic.com',NULL,NULL),(12,'Public Works','161 Erie Street',37.7689,-122.419,'San Francisco','CA',94103,'415-779-6757','publicsf.com',NULL,NULL),(13,'Wish','1539 Folsom Street',37.7713,-122.414,'San Francisco','CA',94103,'415-431-1661','wishsf.com',NULL,NULL),(14,'Holy Cow Nightclub','1535 Folsom Street',37.7714,-122.414,'San Francisco','CA',94103,'415-621-6087','theholycow.com',NULL,NULL),(15,'Beatbox','314 11th Street',37.7715,-122.414,'San Francisco','CA',94103,'415-500-2675','beatboxsf.com',NULL,NULL),(16,'Butter','354 11th Street',37.771,-122.413,'San Francisco','CA',94103,'415-863-5964','smoothasbutter.com',NULL,NULL),(17,'DNA Lounge','375 11th Street',37.771,-122.413,'San Francisco','CA',94103,'415-626-1409','dnalounge.com',NULL,NULL),(18,'Bruno\'s','2389 Mission Street',37.7589,-122.419,'San Francisco','CA',94110,'415-643-5200','brunosf.com',NULL,NULL),(19,'Savanna Jazz','2937 Mission Street',37.75,-122.418,'San Francisco','CA',94110,'415-285-3369','savanajazz.com',NULL,NULL),(20,'El Rio','3158 Mission Street',37.7468,-122.419,'San Francisco','CA',94110,'415-282-3325','elriosf.com',NULL,NULL),(21,'Blondies\' Bar & No Grill','540 Valencia Street',37.7643,-122.422,'San Francisco','CA',94110,'415-864-2419','blondiesbarsf.com',NULL,NULL),(22,'1015 Folsom','1015 Folsom Street',37.7781,-122.406,'San Francisco','CA',94103,'415-431-1200','1015.com',NULL,NULL),(23,'Cat Club','1190 Folsom Street',37.7754,-122.41,'San Francisco','CA',94103,'415-703-8965','sfcatclub.com',NULL,NULL),(24,'Icon Ultra Lounge','1192 Folsom Street',37.7753,-122.41,'San Francisco','CA',94103,'415-626-4800','iconloungesf.comPui',NULL,NULL),(26,'The Endup','401 6th Street',37.7772,-122.404,'San Francisco','CA',94708,'415-896-1075','theendup.com',NULL,NULL),(27,'Ruby Skye','420 Mason Street',37.7876,-122.41,'San Francisco','CA',94102,'415-693-0777','rubyskye.com',NULL,NULL),(28,'Raven Bar','1151 Folsom Street',37.7758,-122.409,'San Francisco','CA',94103,'415-431-1151','ravenbarsf.com',NULL,NULL),(29,'Nob Hill Masonic Center','1111 California Street',37.7912,-122.413,'San Francisco','CA',94108,'415-776-7457','masonicauditorium.com',NULL,NULL),(30,'The Independent','628 Divisadero Street',37.7755,-122.438,'San Francisco','CA',94117,'415-771-1421','theindependentsf.com',NULL,NULL),(31,'SFJAZZ Center','201 Franklin Street',37.7763,-122.422,'San Francisco','CA',94102,'866-920-5299','sfjazz.org',NULL,NULL),(32,'Orpheum Theatre','1192 Market Street',37.7793,-122.415,'San Francisco','CA',94102,'888-746-1799','shnsf.com',NULL,NULL),(33,'The Warfield','982 Market Street',37.7827,-122.41,'San Francisco','CA',94102,'415-345-0900','thewarfieldtheatre.com',NULL,NULL),(34,'Monarch','101 6th Street',37.781,-122.408,'San Francisco','CA',94103,'415-284-9774','monarchsf.com',NULL,NULL),(35,'Mighty','119 Utah Street',37.7675,-122.407,'San Francisco','CA',94103,'415-762-0151','mighty119.com',NULL,NULL),(36,'Thee Parkside','1600 17th Street',37.7651,-122.4,'San Francisco','CA',94107,'415-252-1330','theeparkside.com',NULL,NULL),(37,'Bottom of the Hill','1233 17th Street',37.765,-122.396,'San Francisco','CA',94107,'415-626-4455','bottomofthehill.com',NULL,NULL),(38,'Verdi Club','2424 Mariposa Street',37.7634,-122.408,'San Francisco','CA',94110,'415-861-9199','verdiclub.net',NULL,NULL),(39,'Hemlock Tavern','1131 Polk Street',37.7874,-122.42,'San Francisco','CA',94109,'415-923-0923','hemlocktavern.com',NULL,NULL),(40,'Rickshaw Stop','155 Fell Street',37.7761,-122.42,'San Francisco','CA',94102,'415-861-2011','rickshawstop.com',NULL,NULL),(41,'Biscuits and Blues','401 Mason Street',37.7873,-122.41,'San Francisco','CA',94102,'415-292-2583','biscuitandblues.com',NULL,NULL),(42,'Mezzanine','444 Jessie Street',37.7825,-122.408,'San Francisco','CA',94103,'415-625-8880','mezzaninesf.com',NULL,NULL),(43,'Cafe Royale','800 Post Street',37.7876,-122.415,'San Francisco','CA',94109,'415-441-4099','caferoyale-sf.com',NULL,NULL),(44,'Swig','561 Geary Street',37.7868,-122.413,'San Francisco','CA',94102,'415-931-7292','swigbar.com',NULL,NULL),(45,'Red Devil Lounge','1695 Polk Street',37.7922,-122.421,'San Francisco','CA',94109,'415-921-1695','reddevillounge.com',NULL,NULL),(46,'The Beauty Bar','2299 Mission Street',37.7603,-122.419,'San Francisco','CA',94110,'415-285-0323','thebeautybar.com/san_francisco',NULL,NULL),(47,'Little Baobab','3376 19th Street',37.7603,-122.419,'San Francisco','CA',94110,'415-643-3558','www.bissapbaobab.com',NULL,NULL),(48,'Benders Bar','806 South Van Ness Avenue',37.7602,-122.417,'San Francisco','CA',94110,'415-824-1800','bendersbar.com',NULL,NULL);
/*!40000 ALTER TABLE `venues` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `whatupsf_eventinformation`
--

DROP TABLE IF EXISTS `whatupsf_eventinformation`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `whatupsf_eventinformation` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `eventName` varchar(100) NOT NULL,
  `eventPrice` decimal(4,0) NOT NULL,
  `eventDate` date NOT NULL,
  `eventTime` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `eventUrl` varchar(255) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM AUTO_INCREMENT=13 DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `whatupsf_eventinformation`
--

LOCK TABLES `whatupsf_eventinformation` WRITE;
/*!40000 ALTER TABLE `whatupsf_eventinformation` DISABLE KEYS */;
INSERT INTO `whatupsf_eventinformation` VALUES (6,'Hare Krishna',10,'2014-09-09','2014-10-17 00:26:23','http://www.abc.com'),(7,'Hare Krishna',10,'2014-09-11','2014-10-17 00:27:28','http://www.abc.com'),(8,'Hare Krishna',10,'2014-11-13','2014-10-17 00:27:45','http://www.abc.com'),(9,'Joker',10,'2104-12-25','2014-10-17 06:33:52','http://news.bbc.co.uk'),(10,'egeg',12,'2014-05-31','2014-10-17 08:06:01','http://www.wht.com'),(11,'WFW',9,'2014-11-15','2014-11-16 21:36:33','www.apple.com'),(12,'Bollywood Rock',8,'2015-05-21','2015-06-05 14:43:19','www.seekersguru.com');
/*!40000 ALTER TABLE `whatupsf_eventinformation` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2015-06-05  8:50:37
