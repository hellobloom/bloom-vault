# Introduction

This document defines a data format and encryption algorithm agnostic specification for storing, accessing, and deleting end-to-end encrypted user data blobs. The goals being that:

1. clients written to this specification should not have to trust the registry provider to keep user data private.
2. clients should be able to run on a variety of platforms with minimal integration effort.
3. clients can choose from a variety of encryption algorithms to suite their needs.
4. power users can run their own instance of the data registry on a platform of their choosing.

This specification makes use of AES for client side data encryption and DID Authentication for generating access tokens to modify storage. It requires all encryption and decryption to be performed by the client and that no plain-text data ever be sent to the registry. The communication between client and server is transmitted in accordance with an HTTP API to facilitate integration with a wide variety of platforms and developer backgrounds.

Bloom will be providing an open source reference implementation of the data registry built with docker. This allows power users to easily deploy their own instances of the registry.

This document also defines some suggested methods for safe storage and transmission of AES keys for the purpose of using the registry to sync data between client devices belonging to the same user as well as recommended libraries and default encryption parameters to use for the AES implementation.

# Data Model

This example uses JSON but the implementation could just as easily be normalized SQL tables

Entity:

    {
    	// DID for this entity
    	"did": "did:ethr:0xabc...",
    	"deletedIds": [2,4]
    	// return to the client as base 64 encoded data blob (the format of which is unknown to the registry)
    	"data": [
    		"YXNnYWRnaGFzZGdhZGg0IHVldHNmaGZna2pnaCBka2drbXhnIHNkZmdkZmc",
    		"YXNnYWRnaGFzZGdhZGg0IHVldHNmaGZna2pnaCBka2drbXhnIHNkZmdkZmc",
    		null,
    		"YXNnYWRnaGFzZGdhZGg0IHVldHNmaGZna2pnaCBka2drbXhnIHNkZmdkZmc",
    		null
    	]
    }

When a new data blob is added to an entity the new data should be appended to the end of data array. When a data item is deleted, the cyphertext for that index should be set to null and the index should be appended to the deletedIds array (these two operations should happen atomically). This helps clients quickly check for new data that needs to be synced by querying for the length of the data array or check which of their cached data need to be deleted by querying with their cached deletedCount.

# Authorization Endpoints

## POST /auth/request-token?did=<did:ethr:0x...>

Initiates an access token request challenge for the requested did. If an entity does not already exist with a matching did then one is created. <did> should be replaced with the did:ethr:0x... formatted DID. Returns the access token which needs to be subsequently signed before access is granted

Example POST url:

    https://example.com/auth/request-token?did=did:ethr:0xabc...

Example response (aplication/json):

    {
    	"token": "889a35f4-f4ef-431d-8eb7-629a126f972e"
    }

## POST /auth/validate-token

Validates an access token for the requested DID. The access token and a valid signature of the token must be submitted for the token to be marked as validated. Once validated the token can be used until it is expired. To prevent leaking information about which DIDs have data stored in the registry and to mitigate possible future preimage attacks (**what attacks?**) the registry will process requests in this way.

1. Lookup pending access token and linked entity by the posted access token uuid
    1. If none are found return 404
2. Verify a DID exists for the entity and the posted signature is valid against that key
    1. If either is false return 401
    2. Else authorize the token and return it

Example POST body (application/json):

    // request for a token
    {
    	"accessToken": "889a35f4-f4ef-431d-8eb7-629a126f972e",
    	"signature": "0x123..."
    }

Example response (aplication/json):

    {
    	"expiresAt": 1546883485
    }

# REST Endpoints

The REST endpoints require an authorized access token which can be obtained by using the Authorization endpoints above. Then token must be specified in the Authorization header to the HTTP request `Authorization: Bearer <token>`

Javascript example:

    fetch(
          `http://example.com/data`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
          }
    )

## GET /data/me

Returns the entity object associated with the included access token without the data blobs. 

Example response (aplication/json):

    {
    	"did": "did:ethr:0xabc...",
    	// total number of data blobs
    	"dataCount" : 10,
    	// number of delete data blobs
    	"deletedCount": 2,
    }

## GET /data/:start/:end

Returns the data objects associated with the included access token and between the start and end ids including the end. if end is omitted only the data with the starting id will be returned

**Example GET url:**

    https://example.com/data/7/9
    
    OR
    
    https://example.com/data/7/9?cypherindex=AES_ENCRYPTED_INDEX_VALUE

***Notes on cypherindex:***

The `cypherindex` is an optional query parameter that can be generated by the client and is used to filter the result set by records that match the encrypted value.

**Example response (aplication/json):**

    [
    	{
    		"id": 7,
    		"cyphertext": "YXNnYWRnaGFzZGdhZGg0IHVldHNmaGZna2pnaCBka2drbXhnIHNkZmdkZmc"
    	},
    	{
    		"id": 8,
    		"cyphertext": null,
    	},
    	{
    		"id": 9,
    		"cyphertext": "YXNkZmdlIHJ5NCA1dWV5aiBoIGR0aTM1dXdoZ3R1d3J0aHNhdHdlYWdkaHJ0aGFxcg=="
    	}
    ]

## DELETE /data/:start/:end

Deletes the data objects associated with the included access token and the included ids starting with :start and ending with :and inclusive. Signatures can be included in the body which can be verified upon receiving the deleted data. If signatures are included they must be signatures of the form "delete data id :id" where :id should be replaced with the id of the data being deleted. They also must be in ascending order respective to the ids

    // to delete the 10th 11th and 12th data blobs
    https://example.com/data/9/11

Example optional request body (aplication/json):

    {
    	"signatures": [
    		"0x123...",
    		"0x456...",
    		"0x789...",
    	]
    }

Example response (aplication/json):

    {
    	"dataCount" : 10,
    	"deletedCount": 3
    }

## POST /data

Create a new data blob for the entity associated with the included access token

Example POST url:

    https://example.com/data

**Example request body (aplication/json):**

    {
    	// optional expected id, request will rollback if new id does not match
    	"id": 9,
    	"cyphertext": "YXNnYWRnaGFzZGdhZGg0IHVldHNmaGZna2pnaCBka2drbXhnIHNkZmdkZmc",
      // optional, but recommended, see below notes
      "cypherindex": "AES_ENCRYPTED_INDEX_VALUE"
    }

***Notes on cypherindex:***

The cypherindex is intended as both a private way to improve usability and performance. It's value is up to the client to generate. A recommended implementation for indexing the data as a type `phone` attestation would look like this:

1. Create some JSON that includes a private to the client `nonce` value and the `type` of data that's being stored (in our example `phone`):

    {
      "nonce": "SUFFICIENTLY_RANDOM_STRING_VALUE",
      "type": "phone"
    }

2. Encrypt the JSON string with the same AES key as was used to create the `cyphertext`

The `SUFFICIENTLY_RANDOM_STRING_VALUE` should be stored locally, and is used to make common property values like  `type` of `phone` private / not searchable in the vault db and will be required when using for lookup later in the `GET /data/:end/:start?cypherindex=AES_ENCRYPTED_INDEX_VALUE` request. The same `nonce` value can be used for all indexes, but that's up to the client implementation.

**Example response (aplication/json):**

    {
    	"id": 9
    }

**GET /deletions/:start/:end**

Returns the ids of the data blobs deleted between the **i***th* and **j***th* deletion inclusive. j is optional

Example GET url:

    // to get the third deletion (0 indexed)
    https://example.com/data/deletions/2
    // to get the third fourth, and fifth deletion
    https://example.com/data/deletions/2/4

Example response (aplication/json):

    [
    	{
    		id: 2,
    		"signature": "0xab0..."
    	},
    	{
    		id: 50,
    		"signature": null
    	},
    	{
    		id: 6,
    		"signature": "0xcd1..."
    	}
    ]

A typical scenario might be as follows:

1. Client device A adds 3 data blobs for an entity
2. Entity decides to delete one of the blobs using device A
3. Device A caches the deletedCount as 1
4. The same entity syncs his DID to client device B
5. Client device B notices that the deletedCount is > 0 and calls /deleted/0
6. Entity decides to delete another blob on device B
7. Next time device A syncs it notices the deleted count is now 2 and calls /deleted/1 since it already deleted its cached data for the first deleted item

# Security Recommendations

1. When posting new data:
    1. Make use of the "id" request parameter to prevent replay attacks and duplicated data.
    2. Sign **and** encrypt your data blobs and verify them upon receipt to reduce risk of a malicious provider returning invalid data.
    3. Include the data id in the signed/encrypted data to prevent the possibility of a malicious provider re-ordering your data
2. When deleting data make use of the "signature" parameter and verify it upon receiving deletions. This makes it difficult for a provider to fake a deletion.

## Dependencies

- [docker](https://docs.docker.com/install/)
- [docker-compose](https://docs.docker.com/compose/install/)

## Running debug mode

- install node if you havent already ([version 10 recommended](https://nodejs.org/dist/v10.15.1/)) \*if you have nvm run `nvm use`

```
npm install
npm run docker-debug
```

use the VSCode debug profiles to attach the debugger to the server or the tests or both

## Tests

first start up in debug mode using the commands above then

`npm run test`

## Hot reloading

using the VSCode debug profile "Attach to Docker" will enable hot reloading. Or you can run `npm run watch` in a separate terminal

## Running production mode

first set the required environment variables like so

```
cp .env.sample .env
nano .env #edit your file
chmod 600 .env
```

### if you are using the included postgres image

```
docker-compose -f docker-compose.yml -f docker-db.yml up --build -d
```

### else if you are using an external database

make sure you set the following values in your .env file (see above)

```
POSTGRES_USER
POSTGRES_HOST
POSTGRES_PORT
POSTGRES_DATABASE
```

then start up the container

```
docker-compose up --build -d
```

#### to use a self signed cert for external postgres db

copy the root cert to ./pg_ca.crt then

```
docker-compose -f docker-compose.yml -f docker-pg-ssl.yml up --build
```

## Reseting (will delete ALL data)

`docker-compose -f docker-debug.yml down --volumes`

## Error Logging

if you want errors to be posted as json to an external logging service set the following environement variables

```
LOG_URL
LOG_USER
LOG_PASSWORD
```

the logger will use basic http authentication with the username and password

## Database Backups

if you use the included postgres image and want to periodically back up the volume, set the `BACKUP_LOCATION` environment variable to a location on the host machine

## Gotchas

- the POSTGRES_PASSWORD will be set in the volume the first time running and will not reset between rebuilding the images. If you want to change the password you have to either remove the volume using the command above or connect using a pg client and change it
