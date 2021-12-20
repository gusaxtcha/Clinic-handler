require("dotenv").config();

const request = require("request");
const mongoose = require("mongoose");
const mqtt = require("mqtt");
const DentistsData = require("./models/dentist");
const dentist = require("./models/dentist");

// Variables
const mongoURI = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@dentistimo0.vd9sq.mongodb.net/Dentistimo`;
const port = process.env.PORT || 3000;
const connectUrl = `mqtt://localhost:1883`;

// Subscribed Topics
const newClinicTopic = "new_clinic";
const storedClinicTopic = "stored_new_clinic";
const getAllClinics = "get_all_clinics";
const getAClinic = "get_a_clinic";

const listOfSubscribedTopics = [
  newClinicTopic,
  getAllClinics,
  getAClinic
]

// Published topics
const publishOneClinicFailed = "send_a_clinic/failed";
const publishOneClinicSucceeded = "send_a_clinic/succeeded";
const publishError = "clinicService/Error";

// Connect to MongoDB
mongoose.connect(
  mongoURI,
  { useNewUrlParser: true, useUnifiedTopology: true },
  function (err) {
    if (err) {
      console.error("Failed to connect to MongoDB");
      console.error(err.stack);
      process.exit(1);
    }
    console.log("Connected to MongoDB");
  }
);

// Connect MQTT
const client = mqtt.connect(connectUrl, {
  clientId: 'Clinic Handler n°'+ Math.random().toString(16).substr(2, 8),
  clean: true,
  will: {
    topic: "Team5/Dentistimo/ClinicHandler/LastWill",
    payload: "Clinic handler has been disconnected from the system",
    qos: 1
  }
});

module.exports.mqttClient = client;

// Subscribe to new topics
client.on("connect", () => {
  console.log("Connected");
  client.subscribe([newClinicTopic, getAllClinics, getAClinic], () => {
    console.log(`Subscribe to topic '${newClinicTopic}'`);
  });
});

/**  Listens to message reception and reacts based on the topic */
client.on("message", async (topic, payload) => {
  console.log("Received Message:", topic, payload.toString());
  switch (topic) {
    case newClinicTopic:
      addNewClinic(payload);
      break;
    case getAllClinics:
      publishAllClinics();
      break;
    case getAClinic:
      getClinic(payload);
      break;
    default:
      break;
  }
});

const addNewClinic = (payload) => {
  try {
    const data = JSON.parse(payload);
  } catch (error) {
    client.publish(publishError, 'Parsing error: ' + error.toString());
    console.log(error)
  }
  
  const dentist = new DentistsData(data);
  dentist.save(function (err, newDentist) {
    if (err) return console.error(err);
    console.log(dentist.name + " saved to database.");
    client.publish(storedClinicTopic, JSON.stringify(newDentist));
  });
};

const publishAllClinics = async () => {
  const dentists = await dentist.find();
  dentists.forEach((dentist) => {
    client.publish(storedClinicTopic, JSON.stringify(dentist));
    console.log("Published dentists:" + dentist.name);
  });
};
/**
 * Method that parses the message into a json object and forwards it to query the database.
 * @param payload (message as a string). Needs to contain the database _id and be parsable into a JSON object.
 */
function getClinic(payload) {
  try {
    let requestedClinic = JSON.parse(payload);
    getClinicFromDatabase(requestedClinic);
  } catch (error) {
    client.publish(publishError, 'Parsing error: ' + error.toString());
    console.log(error)
  } 
}

/**
 * Query the database to retrieve a given clinic. Publishes the result of the query to the appropriate topics via mqtt.
 * @param requestedClinic json object clinic: Needs to contain the database _id and be parsable into a JSON object.
 */
function getClinicFromDatabase(requestedClinic) {
  let clinicID = requestedClinic._id;
  dentist.findById(clinicID, function (err, clinic) {
    if (err) {
      client.publish(
        publishOneClinicFailed,
        JSON.stringify({ error: err.message }),
        { qos: 1 }
      );
    } else {
      if (clinic !== null) {
        client.publish(
          publishOneClinicSucceeded,
          JSON.stringify(JSON.stringify(clinic)),
          { qos: 1 }
        );
      } else {
        client.publish(
          publishOneClinicFailed,
          JSON.stringify({ error: "Clinic not found in the database." }),
          { qos: 1 }
        );
      }
    }
  });
}

// Get dentist data from URL and publish
function updateDB() {
  request(
    "https://raw.githubusercontent.com/feldob/dit355_2020/master/dentists.json",
    { json: true },
    async (err, res, body) => {
      if (err) {
        return console.log(err);
      }
      await DentistsData.deleteMany({});
      //store in database
      DentistsData.create(body.dentists, function (err, dentists) {
        if (err) {
          console.error(err);
          return;
        }
        dentists.forEach((dentist) => {
          client.publish(storedClinicTopic, JSON.stringify(dentist));
          console.log("Published dentists:" + dentist.name);
        });
      });
    }
  );
}

/**
 * Unsubscribe and disconnect from the broker.
 */
module.exports.disconnect = function(){
    listOfSubscribedTopics.forEach(topic => {
      client.unsubscribe(topic, console.log('Unsubscribing to topic ' + topic))
    })
  client.end()
  console.log('Disconnecting from MQTT broker.')
}

// Updates database
setInterval(() => updateDB(), 1000 * 60 * 60 * 24);
updateDB();
