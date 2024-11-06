// controllers/msg91Controller.js
import https from 'https';

import dotenv from 'dotenv';
dotenv.config();

const MSG91_AUTH_KEY =process.env.MSG91_AUTH_KEY;


// const sendOtp = (req, res) => {
//     const { mobile } = req.body;

//     const DEFAULT_TEMPLATE_ID =process.env.DEFAULT_TEMPLATE_ID;

//     // Use the provided template_id or fall back to the default
//     const template_id =  DEFAULT_TEMPLATE_ID;


//     const options = {
//         method: 'POST',
//         hostname: 'control.msg91.com',
//         path: `/api/v5/otp?authkey=${MSG91_AUTH_KEY}&mobile=${mobile}&template_id=${template_id}`,
//         headers: {
//             'Content-Type': 'application/json',
//         },
//     };

//     const reqMsg91 = https.request(options, (response) => {
//         const chunks = [];

//         response.on('data', (chunk) => {
//             chunks.push(chunk);
//         });

//         response.on('end', () => {
//             const body = Buffer.concat(chunks);
//             res.status(response.statusCode).json(JSON.parse(body.toString()));
//         });
//     });

//     reqMsg91.on('error', (error) => {
//         console.error(error);
//         res.status(500).json({ error: 'Internal Server Error' });
//     });

//     reqMsg91.write(JSON.stringify({ Param1: 'value1', Param2: 'value2', Param3: 'value3' }));
//     reqMsg91.end();
// };



const sendOtp = (req, res) => {
    const { mobile } = req.body;
    const DEFAULT_TEMPLATE_ID = process.env.DEFAULT_TEMPLATE_ID;
    const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY; // Make sure this is set in your environment

    const template_id = DEFAULT_TEMPLATE_ID;
   
    if (typeof mobile === 'number') {
        mobile = mobile.toString();
    }
   
    const options = {
        method: 'POST',
        hostname: 'control.msg91.com',
        path: `/api/v5/otp?authkey=${MSG91_AUTH_KEY}&mobile=${mobile}&template_id=${template_id}`,
        headers: {
            'Content-Type': 'application/json',
        },
    };

    const reqMsg91 = https.request(options, (response) => {
        const chunks = [];

        // Collect response chunks
        response.on('data', (chunk) => {
            chunks.push(chunk);
        });

        // Once the response ends, process the full response body
        response.on('end', () => {
            const body = Buffer.concat(chunks).toString();
            let jsonResponse;

            try {
                // Attempt to parse the response as JSON
                jsonResponse = JSON.parse(body);
            } catch (error) {
                console.error('Failed to parse JSON response:', error);
                return res.status(500).json({ error: 'Invalid JSON response from MSG91', details: body });
            }

            // Check if the response is successful or not
            if (jsonResponse.type === 'success') {
                console.log('Success response from MSG91:', jsonResponse);
                res.status(200).json(jsonResponse); // Send full response
            } else {
                console.error('Error response from MSG91:', jsonResponse);
                res.status(500).json({ error: 'Failed to send OTP', details: jsonResponse });
            }
        });
    });

    // Handle request error
    reqMsg91.on('error', (error) => {
        console.error('Request error:', error);
        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    });

    // Write the body of the request with custom parameters (if needed)
    reqMsg91.write(JSON.stringify({
        Param1: 'value1',  // Modify these parameters if necessary
        Param2: 'value2', 
        Param3: 'value3'
    }));

    reqMsg91.end(); // End the request
};




const retryOtp = (req, res) => {
    const { mobile } = req.query;
    const options = {
        method: 'GET',
        hostname: 'control.msg91.com',
        path: `/api/v5/otp/retry?authkey=${MSG91_AUTH_KEY}&mobile=${mobile}`,
        headers: {},
    };

    const reqMsg91 = https.request(options, (response) => {
        const chunks = [];

        response.on('data', (chunk) => {
            chunks.push(chunk);
        });

        response.on('end', () => {
            const body = Buffer.concat(chunks);
            res.status(response.statusCode).json(JSON.parse(body.toString()));
        });
    });

    reqMsg91.on('error', (error) => {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    });

    reqMsg91.end();
};

const verifyOtp = (req, res) => {
    const { otp, mobile } = req.query;
    const options = {
        method: 'GET',
        hostname: 'control.msg91.com',
        path: `/api/v5/otp/verify?authkey=${MSG91_AUTH_KEY}&otp=${otp}&mobile=${mobile}`,
        headers: {},
    };

    const reqMsg91 = https.request(options, (response) => {
        const chunks = [];

        response.on('data', (chunk) => {
            chunks.push(chunk);
        });

        response.on('end', () => {
            const body = Buffer.concat(chunks);
            res.status(response.statusCode).json(JSON.parse(body.toString()));
        });
    });

    reqMsg91.on('error', (error) => {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    });

    reqMsg91.end();
};

const updateOtpTemplate = (req, res) => {
    const { templateId, template, dltTemplateId, senderId } = req.body;
    const options = {
        method: 'POST',
        hostname: 'control.msg91.com',
        path: '/api/v5/otp/updateOtpTemplate',
        headers: {
            'Content-Type': 'application/json',
            'authkey': MSG91_AUTH_KEY,
        },
    };

    const reqMsg91 = https.request(options, (response) => {
        const chunks = [];

        response.on('data', (chunk) => {
            chunks.push(chunk);
        });

        response.on('end', () => {
            const body = Buffer.concat(chunks);
            res.status(response.statusCode).json(JSON.parse(body.toString()));
        });
    });

    reqMsg91.on('error', (error) => {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    });

    reqMsg91.write(JSON.stringify({ templateId, template, dltTemplateId, senderId }));
    reqMsg91.end();
};

const getAnalyticsReport = (req, res) => {
    const { startDate, endDate } = req.query;
    const options = {
        method: 'GET',
        hostname: 'control.msg91.com',
        path: `/api/v5/report/analytics/p/otp?startDate=${startDate}&endDate=${endDate}&authkey=${MSG91_AUTH_KEY}`,
        headers: {
            'Content-Type': 'text/plain',
        },
    };

    const reqMsg91 = https.request(options, (response) => {
        const chunks = [];

        response.on('data', (chunk) => {
            chunks.push(chunk);
        });

        response.on('end', () => {
            const body = Buffer.concat(chunks);
            res.status(response.statusCode).json(JSON.parse(body.toString()));
        });
    });

    reqMsg91.on('error', (error) => {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    });

    reqMsg91.end();
};

export {
    sendOtp,
    retryOtp,
    verifyOtp,
    updateOtpTemplate,
    getAnalyticsReport,
};
