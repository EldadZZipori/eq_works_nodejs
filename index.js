const express = require('express')
const pg = require('pg')

const dotenv = require('dotenv'); 
dotenv.config(); // Configure the environmental vars in .env 

// Redis package with Promise implemented
// Redis officle packege does not support Promises yet
const asyncRedis = require("async-redis");    
const redisClient = asyncRedis.createClient({host: process.env.REDIS_HOST, port: process.env.REDIS_PORT});

const app = express()
// configs come from standard PostgreSQL env vars
// https://www.postgresql.org/docs/9.6/static/libpq-envars.html
const pool = new pg.Pool({
  user: process.env.PGUSER ,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT
})

// Implementing rate limiter on all pages
// The LIMIT for each ip can be set in the .env file
app.use(async(req, res, next) =>{
  console.log("in")
  let limitCheck = await checkLimit( req.ip );
  
  if (limitCheck) {
    res.status(429).send('Too many requests');
    return;
  }
  next()
})

// Checking the how many requests a certian ip had
// Redis is taking care of decreasing the value of how many access an ip had
async function checkLimit( ip ) {
  let res

  try {
      await redisClient.incr( ip )
      res = await redisClient.get( ip ) 
  } catch (err) {
      console.log(`[-] Could not access key ${ip}`)
      return;
  }
  
  console.log(`[*] Incremented ${ip} to ${res}`)

  if ( parseInt(res) > process.env.LIMITER ) return true

  redisClient.expire( ip, process.env.LIMITER)
}

const queryHandler = (req, res, next) => {
  pool.query(req.sqlQuery).then((r) => {
    return res.json(r.rows || [])
  }).catch(next)
}
app.get('/error', (req,res) => {
  res.send("Cannot Access This Right Now");
})
app.get('/', async (req, res) => {
  res.send('Welcome to EQ Works 😎');
})

app.get('/events/hourly', (req, res, next) => {
  req.sqlQuery = `
    SELECT date, hour, events
    FROM public.hourly_events
    ORDER BY date, hour
    LIMIT 168;
  `
  return next()
}, queryHandler)

app.get('/events/daily', (req, res, next) => {
  req.sqlQuery = `
    SELECT date, SUM(events) AS events
    FROM public.hourly_events
    GROUP BY date
    ORDER BY date
    LIMIT 7;
  `
  return next()
}, queryHandler)

app.get('/stats/hourly', (req, res, next) => {
  req.sqlQuery = `
    SELECT date, hour, impressions, clicks, revenue
    FROM public.hourly_stats
    ORDER BY date, hour
    LIMIT 168;
  `
  return next()
}, queryHandler)

app.get('/stats/daily', (req, res, next) => {
  req.sqlQuery = `
    SELECT date,
        SUM(impressions) AS impressions,
        SUM(clicks) AS clicks,
        SUM(revenue) AS revenue
    FROM public.hourly_stats
    GROUP BY date
    ORDER BY date
    LIMIT 7;
  `
  return next()
}, queryHandler)

app.get('/poi', (req, res, next) => {
  req.sqlQuery = `
    SELECT *
    FROM public.poi;
  `
  return next()
}, queryHandler)

app.listen(process.env.PORT || 5555, (err) => {
  
  if (err) {
    console.error(err)
    process.exit(1)
  } else {
    console.log(`Running on ${process.env.PORT || 5555}`)
    
  }
})

// last resorts
process.on('uncaughtException', (err) => {
  console.log(`Caught exception: ${err}`)
  process.exit(1)
})
process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: Promise', p, 'reason:', reason)
  process.exit(1)
})