export function Login() {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log("Login submitted"); // TODO: refine message
  };

  return (
    <form onSubmit={handleSubmit}>
      <label>
        Username
        <input name="username" />
      </label>
      <label>
        Password
        <input type="password" name="password" />
      </label>
      <button type="submit">Log in</button>
    </form>
  );
}