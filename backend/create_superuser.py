from app.db.session import SessionLocal
from app.models.user import User
from app.core.security import get_password_hash

def create_superuser(email: str, password: str):
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        if user:
            print(f"User with email {email} already exists.")
            # Ensure it is a superuser
            if not user.is_superuser:
                user.is_superuser = True
                user.is_anonymous = False
                db.commit()
                print(f"Updated user {email} to superuser.")
            return

        superuser = User(
            email=email,
            hashed_password=get_password_hash(password),
            is_superuser=True,
            is_anonymous=False,
            display_name="Super Admin",
        )
        db.add(superuser)
        db.commit()
        print(f"Superuser {email} created successfully.")
    finally:
        db.close()

if __name__ == "__main__":
    import sys
    if len(sys.argv) < 3:
        print("Usage: python create_superuser.py <email> <password>")
    else:
        create_superuser(sys.argv[1], sys.argv[2])
