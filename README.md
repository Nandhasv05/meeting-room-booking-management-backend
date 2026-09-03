<div align="center">

# 🏢 Meeting Room Booking Management

<img src="https://readme-typing-svg.demolab.com?font=Fira+Code&size=25&pause=1000&color=36BCF7&center=true&vCenter=true&width=750&lines=Meeting+Room+Booking+Management;Backend+API+Application;Node.js+%7C+TypeScript+%7C+Express.js;Secure+REST+API;Room+Booking+%26+Availability+Management" />

<br/>

<p>
  <strong>A secure and scalable backend API for managing meeting rooms, bookings, users, availability and meeting invitations.</strong>
</p>

<br/>

<img src="https://img.shields.io/badge/Node.js-18%2B-339933?style=for-the-badge&logo=node.js&logoColor=white" />
<img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
<img src="https://img.shields.io/badge/Express.js-REST_API-000000?style=for-the-badge&logo=express&logoColor=white" />
<img src="https://img.shields.io/badge/MySQL-Database-4479A1?style=for-the-badge&logo=mysql&logoColor=white" />

<br/>

<img src="https://img.shields.io/badge/JWT-Authentication-purple?style=for-the-badge&logo=jsonwebtokens&logoColor=white" />
<img src="https://img.shields.io/badge/PM2-Production-2B037A?style=for-the-badge&logo=pm2&logoColor=white" />
<img src="https://img.shields.io/badge/Nginx-Reverse_Proxy-009639?style=for-the-badge&logo=nginx&logoColor=white" />

</div>

---

## 📌 About The Project

**Meeting Room Booking Management** is a web-based meeting room management system designed to simplify the process of booking, managing and monitoring meeting rooms within an organization.

The backend provides REST APIs for:

- 🔐 Authentication
- 👥 Employee/User management
- 🏢 Meeting room management
- 📅 Meeting room booking
- 🔎 Room availability
- ✉️ Meeting invitations
- 📊 Audit logs
- 📁 File uploads
- 🔒 Role-based authorization

The backend is developed using **Node.js, TypeScript, Express.js and MySQL**.

---

# ✨ Features

## 🔐 Authentication

- User login
- JWT-based authentication
- Secure protected routes
- Token-based API access
- Authentication middleware
- Role-based authorization

---

## 👥 User Management

- Employee management
- User information management
- User role management
- Active/inactive user handling
- User-based booking access

---

## 🏢 Meeting Room Management

Administrators can manage meeting rooms.

Features include:

- Create meeting room
- Update meeting room
- Delete meeting room
- View meeting rooms
- Room status management
- Room availability checking

---

## 📅 Meeting Booking

Employees can book meeting rooms based on availability.

Booking features:

- Select meeting room
- Select date
- Select start time
- Select end time
- Add meeting title
- Add meeting description
- Add participants
- Check room availability
- Create booking
- Update booking
- Cancel booking
- View booking history

---

## 🔎 Room Availability

The system prevents conflicting bookings.

Example:

```text
Room A

10:00 AM ───────── 11:00 AM
        BOOKED

11:00 AM ───────── 12:00 PM
        AVAILABLE

12:00 PM ───────── 01:00 PM
        BOOKED
