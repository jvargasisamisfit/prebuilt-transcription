/* eslint-disable react/no-unescaped-entities */
import type { NextPage } from "next";
import Head from "next/head";
import Link from "next/link";
import { useState, useEffect } from "react";
import Header from "../components/Header";

import styles from "../styles/Home.module.css";

function Form() {
  let [isCreating, setIsCreating] = useState<boolean>(false);
  let [isCreated, setIsCreated] = useState<boolean>(false);
  let [link, setLink] = useState<string>("");
  let [error, setError] = useState<string>("");
  let [userName, setUserName] = useState<string>("");

  useEffect(() => {
    // Load username from localStorage
    const savedName = localStorage.getItem("dailyUserName");
    if (savedName) {
      setUserName(savedName);
    }
  }, []);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value;
    setUserName(name);
    localStorage.setItem("dailyUserName", name);
  };

  const createRoom = async () => {
    setIsCreating(true);
    setError("");

    try {
      const response = await fetch("/api/create-room", {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create room");
      }

      // Build the full URL using the room name from the API response
      // Include the owner token if provided
      let roomUrl = `${window.location.origin}/${process.env.NEXT_PUBLIC_DAILY_DOMAIN || 'misfits'}/${data.name}`;
      if (data.token) {
        roomUrl += `?t=${data.token}`;
      }
      setLink(roomUrl);
      setIsCreated(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsCreating(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(link);
  };

  const resetForm = () => {
    setIsCreated(false);
    setLink("");
    setError("");
  };

  return (
    <div>
      {!isCreated ? (
        <div className={styles.form}>
          <label htmlFor="userName">Your Name</label>
          <input
            id="userName"
            type="text"
            value={userName}
            onChange={handleNameChange}
            placeholder="Enter your name"
            autoComplete="name"
          />
          <button
            onClick={createRoom}
            disabled={isCreating}
            type="button"
          >
            {isCreating ? "Creating Room..." : "Create Room"}
          </button>
          {error && <p className={styles.error}>{error}</p>}
        </div>
      ) : (
        <div className={styles.linkGroup}>
          <Link href={link}>
            <a>{link}</a>
          </Link>
          <div>
            <a onClick={copyToClipboard}>Copy</a>
            <a href={link}>Join</a>
            <a onClick={resetForm}>Create Another</a>
          </div>
          <span>
            Share this link with others to join your room!
          </span>
        </div>
      )}
    </div>
  );
}

const Home: NextPage = ({}) => {
  return (
    <div>
      <Head>
        <title>🎙️ Daily Prebuilt + Transcription 🎙️</title>
        <meta name="description" content="" />
        <link rel="icon" href="/favicon.png" />
      </Head>
      <Header error={""} isTranscribing={false} owner={false} token={false} />
      <main className="index">
        <h1>🎙️ Daily Prebuilt + Transcription 🎙️</h1>
        <p>
          Check out this repo's{" "}
          <a href="https://github.com/daily-demos/prebuilt-transcription">
            README
          </a>{" "}
          for setup details.
        </p>
        <Form></Form>
      </main>
    </div>
  );
};

export default Home;
